use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2");

const CONFIG_SEED: &[u8] = b"config_v2";
const HOUSE_SEED: &[u8] = b"house_v2";
const ROUND_SEED: &[u8] = b"round_v2";
const BET_SEED: &[u8] = b"bet_v2";
const VAULT_SEED: &[u8] = b"vault_v2";

const BOARD_SIZE: usize = 20;
const BOARD_CELLS: usize = BOARD_SIZE * BOARD_SIZE;
const MAX_MOVES: u32 = 500;

const CELL_EMPTY: u8 = 0;
const CELL_FOOD: u8 = 2;
const SNAKE_MIN: u8 = 3;
const SNAKE_MAX: u8 = 8;

const MIN_BET_LAMPORTS: u64 = 10_000_000; // 0.01 SOL
const MAX_BET_LAMPORTS: u64 = 1_000_000_000; // 1 SOL

const CONFIG_SPACE: usize = 80;
const HOUSE_SPACE: usize = 8;
const ROUND_SPACE: usize = 1200;
const BET_SPACE: usize = 64;
const VAULT_SPACE: usize = 16;

#[ephemeral]
#[program]
pub mod magic_bet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fund_amount: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.agent = None;
        config.round_id = 0;
        config.house_bump = ctx.bumps.house;
        config.vault_bump = 0;
        config.house_fee_bps = 0;

        let house = &mut ctx.accounts.house;
        house.bump = ctx.bumps.house;

        if fund_amount > 0 {
            let transfer_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.house.to_account_info(),
                },
            );
            system_program::transfer(transfer_ctx, fund_amount)?;
        }

        Ok(())
    }

    pub fn delegate_admin(ctx: Context<DelegateAdmin>, agent: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.config.admin,
            ctx.accounts.admin.key(),
            MagicBetError::Unauthorized
        );
        ctx.accounts.config.agent = Some(agent);
        Ok(())
    }

    pub fn create_round(ctx: Context<CreateRound>, round_id: u64, duration: i64) -> Result<()> {
        require!(duration > 0, MagicBetError::InvalidDuration);

        let config = &mut ctx.accounts.config;
        require_admin_or_agent(config, ctx.accounts.signer.key())?;
        require!(round_id == config.round_id, MagicBetError::InvalidRoundId);

        let round = &mut ctx.accounts.round;
        round.round_id = round_id;
        round.status = RoundStatus::Active;
        round.winner = None;
        round.alpha_board = [CELL_EMPTY; BOARD_CELLS];
        round.beta_board = [CELL_EMPTY; BOARD_CELLS];
        round.alpha_seed = make_seed(round_id, 0xA11A_A11A_A11A_A11A);
        round.beta_seed = make_seed(round_id, 0xB37A_B37A_B37A_B37A);
        round.alpha_score = 0;
        round.beta_score = 0;
        round.alpha_alive = true;
        round.beta_alive = true;
        round.move_count = 0;
        round.alpha_pool = 0;
        round.beta_pool = 0;
        round.start_time = Clock::get()?.unix_timestamp;
        round.end_time = None;
        round.duration = duration;
        round.alpha_head = 0;
        round.beta_head = 0;
        round.alpha_food = 0;
        round.beta_food = 0;
        round.alpha_dir = Direction::Right;
        round.beta_dir = Direction::Left;
        round.alpha_death_move = None;
        round.beta_death_move = None;
        round.bump = ctx.bumps.round;

        initialize_round_state(round)?;

        let vault = &mut ctx.accounts.vault;
        vault.round_id = round_id;
        vault.bump = ctx.bumps.vault;

        config.round_id = config
            .round_id
            .checked_add(1)
            .ok_or(MagicBetError::ArithmeticOverflow)?;
        config.vault_bump = ctx.bumps.vault;

        Ok(())
    }

    pub fn delegate_round(ctx: Context<DelegateRound>, round_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require_admin_or_agent(config, ctx.accounts.signer.key())?;
        require!(
            ctx.accounts.round.status == RoundStatus::InProgress,
            MagicBetError::RoundNotInProgress
        );

        let validator = ctx.remaining_accounts.first().map(|acc| acc.key());
        let round_id_bytes = round_id.to_le_bytes();
        let round_seeds: &[&[u8]] = &[ROUND_SEED, &round_id_bytes];

        ctx.accounts.delegate_round_pda(
            &ctx.accounts.signer,
            round_seeds,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        round_id: u64,
        choice: AIChoice,
        amount: u64,
    ) -> Result<()> {
        require!(amount >= MIN_BET_LAMPORTS, MagicBetError::BetAmountTooLow);
        require!(amount <= MAX_BET_LAMPORTS, MagicBetError::BetAmountTooHigh);
        require!(
            ctx.accounts.round.status == RoundStatus::Active,
            MagicBetError::RoundNotActive
        );

        let bet = &mut ctx.accounts.bet;
        let is_new_bet = bet.user == Pubkey::default();

        let existing_amount = if is_new_bet {
            0
        } else {
            require_keys_eq!(bet.user, ctx.accounts.user.key(), MagicBetError::Unauthorized);
            require!(bet.round_id == round_id, MagicBetError::InvalidRoundId);
            require!(bet.choice == choice, MagicBetError::BetChoiceImmutable);
            require!(!bet.claimed, MagicBetError::AlreadyClaimed);
            bet.amount
        };

        let potential_payout = existing_amount
            .checked_add(amount)
            .ok_or(MagicBetError::ArithmeticOverflow)?;
        let existing_exposure = ctx
            .accounts
            .round
            .alpha_pool
            .checked_add(ctx.accounts.round.beta_pool)
            .ok_or(MagicBetError::ArithmeticOverflow)?
            .checked_mul(2)
            .ok_or(MagicBetError::ArithmeticOverflow)?;
        let required_house_lamports = existing_exposure
            .checked_add(
                potential_payout
                    .checked_mul(2)
                    .ok_or(MagicBetError::ArithmeticOverflow)?,
            )
            .ok_or(MagicBetError::ArithmeticOverflow)?;

        require!(
            ctx.accounts.house.to_account_info().lamports() >= required_house_lamports,
            MagicBetError::InsufficientHouseFunds
        );

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, amount)?;

        if is_new_bet {
            bet.round_id = round_id;
            bet.user = ctx.accounts.user.key();
            bet.choice = choice;
            bet.amount = amount;
            bet.claimed = false;
            bet.bump = ctx.bumps.bet;
        } else {
            bet.amount = bet
                .amount
                .checked_add(amount)
                .ok_or(MagicBetError::ArithmeticOverflow)?;
        }

        match choice {
            AIChoice::Alpha => {
                ctx.accounts.round.alpha_pool = ctx
                    .accounts
                    .round
                    .alpha_pool
                    .checked_add(amount)
                    .ok_or(MagicBetError::ArithmeticOverflow)?;
            }
            AIChoice::Beta => {
                ctx.accounts.round.beta_pool = ctx
                    .accounts
                    .round
                    .beta_pool
                    .checked_add(amount)
                    .ok_or(MagicBetError::ArithmeticOverflow)?;
            }
            AIChoice::Draw => return err!(MagicBetError::InvalidBetChoice),
        }

        Ok(())
    }

    pub fn close_betting(ctx: Context<CloseBetting>, _round_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require_admin_or_agent(config, ctx.accounts.signer.key())?;
        require!(
            ctx.accounts.round.status == RoundStatus::Active,
            MagicBetError::RoundNotActive
        );

        ctx.accounts.round.status = RoundStatus::InProgress;
        Ok(())
    }

    pub fn execute_move(ctx: Context<ExecuteMove>, _round_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require_admin_or_agent(config, ctx.accounts.signer.key())?;

        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::InProgress,
            MagicBetError::RoundNotInProgress
        );
        require!(round.winner.is_none(), MagicBetError::RoundAlreadyResolved);

        let move_number = round
            .move_count
            .checked_add(1)
            .ok_or(MagicBetError::ArithmeticOverflow)?;

        let mut alpha = SnakeRuntime::from_alpha(round);
        let mut beta = SnakeRuntime::from_beta(round);

        let alpha_direction = alpha.choose_aggressive_direction();
        let beta_direction = beta.choose_defensive_direction();

        alpha.apply_move(alpha_direction, move_number);
        beta.apply_move(beta_direction, move_number);

        alpha.write_back_alpha(round);
        beta.write_back_beta(round);
        round.move_count = move_number;

        let force_resolution = round.move_count >= max_round_moves(round.duration);
        if let Some(winner) = determine_winner(round, force_resolution) {
            round.winner = Some(winner);
        }

        Ok(())
    }

    pub fn settle_and_undelegate(
        ctx: Context<SettleAndUndelegate>,
        _round_id: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require_admin_or_agent(config, ctx.accounts.payer.key())?;

        let round = &mut ctx.accounts.round;
        require!(
            round.status == RoundStatus::InProgress,
            MagicBetError::RoundNotInProgress
        );

        if round.winner.is_none() {
            round.winner = determine_winner(round, true);
        }
        if round.winner.is_none() {
            round.winner = Some(AIChoice::Draw);
        }

        round.status = RoundStatus::Settled;
        round.end_time = Some(Clock::get()?.unix_timestamp);

        round.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.round.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>, _round_id: u64) -> Result<()> {
        require!(
            ctx.accounts.round.status == RoundStatus::Settled,
            MagicBetError::RoundNotSettled
        );

        let winner = ctx
            .accounts
            .round
            .winner
            .ok_or(MagicBetError::RoundNotSettled)?;
        require!(winner != AIChoice::Draw, MagicBetError::DrawNoPayout);

        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, MagicBetError::AlreadyClaimed);
        require!(bet.choice == winner, MagicBetError::DidNotWin);

        let payout = bet
            .amount
            .checked_mul(2)
            .ok_or(MagicBetError::ArithmeticOverflow)?;

        require!(
            ctx.accounts.house.to_account_info().lamports() >= payout,
            MagicBetError::InsufficientHouseFunds
        );

        // House is a program-owned PDA carrying data, so payout must use
        // direct lamport mutation instead of SystemProgram::transfer.
        let house_balance = ctx.accounts.house.to_account_info().lamports();
        let user_balance = ctx.accounts.user.to_account_info().lamports();

        let new_house_balance = house_balance
            .checked_sub(payout)
            .ok_or(MagicBetError::ArithmeticOverflow)?;
        let new_user_balance = user_balance
            .checked_add(payout)
            .ok_or(MagicBetError::ArithmeticOverflow)?;

        **ctx.accounts.house.to_account_info().try_borrow_mut_lamports()? = new_house_balance;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? = new_user_balance;

        bet.claimed = true;
        Ok(())
    }

    pub fn close_bet(ctx: Context<CloseBet>, _round_id: u64, _user: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.round.status == RoundStatus::Settled,
            MagicBetError::RoundNotSettled
        );

        if let Some(winner) = ctx.accounts.round.winner {
            if winner == ctx.accounts.bet.choice {
                require!(ctx.accounts.bet.claimed, MagicBetError::UnclaimedWinningBet);
            }
        }

        Ok(())
    }

    pub fn fund_house(ctx: Context<FundHouse>, amount: u64) -> Result<()> {
        require_admin_or_agent(&ctx.accounts.config, ctx.accounts.signer.key())?;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.house.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, amount)?;

        Ok(())
    }

    pub fn sweep_vault(ctx: Context<SweepVault>, _round_id: u64) -> Result<()> {
        require_admin_or_agent(&ctx.accounts.config, ctx.accounts.signer.key())?;
        require!(
            ctx.accounts.round.status == RoundStatus::Settled,
            MagicBetError::RoundNotSettled
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + CONFIG_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + HOUSE_SPACE, seeds = [HOUSE_SEED], bump)]
    pub house: Account<'info, House>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateAdmin<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, _duration: i64)]
pub struct CreateRound<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = signer,
        space = 8 + ROUND_SPACE,
        seeds = [ROUND_SEED, &round_id.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = signer,
        space = 8 + VAULT_SPACE,
        seeds = [VAULT_SEED, &round_id.to_le_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DelegateRound<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: Delegated round PDA; verified by seeds and bump constraints.
    #[account(
        mut,
        del,
        seeds = [ROUND_SEED, &round_id.to_le_bytes()],
        bump
    )]
    pub round_pda: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, _choice: AIChoice, _amount: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [VAULT_SEED, &round_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + BET_SPACE,
        seeds = [BET_SEED, &round_id.to_le_bytes(), user.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, House>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseBetting<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ExecuteMove<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[commit]
#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SettleAndUndelegate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [BET_SEED, &round_id.to_le_bytes(), user.key().as_ref()], bump = bet.bump)]
    pub bet: Account<'info, Bet>,
    #[account(mut, seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, House>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, user: Pubkey)]
pub struct CloseBet<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [BET_SEED, &round_id.to_le_bytes(), user.as_ref()],
        bump = bet.bump,
        close = user_account
    )]
    pub bet: Account<'info, Bet>,
    /// CHECK: Receives reclaimed rent from closed bet account.
    #[account(mut, address = user)]
    pub user_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct FundHouse<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, House>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SweepVault<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, House>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &round_id.to_le_bytes()],
        bump = vault.bump,
        close = house
    )]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub agent: Option<Pubkey>,
    pub round_id: u64,
    pub house_bump: u8,
    pub vault_bump: u8,
    pub house_fee_bps: u16,
}

#[account]
pub struct House {
    pub bump: u8,
}

#[account]
pub struct Vault {
    pub round_id: u64,
    pub bump: u8,
}

#[account]
pub struct Round {
    pub round_id: u64,
    pub status: RoundStatus,
    pub winner: Option<AIChoice>,

    pub alpha_board: [u8; BOARD_CELLS],
    pub beta_board: [u8; BOARD_CELLS],

    pub alpha_seed: u64,
    pub beta_seed: u64,
    pub alpha_score: u32,
    pub beta_score: u32,
    pub alpha_alive: bool,
    pub beta_alive: bool,
    pub move_count: u32,

    pub alpha_pool: u64,
    pub beta_pool: u64,

    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: i64,

    pub alpha_head: u16,
    pub beta_head: u16,
    pub alpha_food: u16,
    pub beta_food: u16,
    pub alpha_dir: Direction,
    pub beta_dir: Direction,

    pub alpha_death_move: Option<u32>,
    pub beta_death_move: Option<u32>,

    pub bump: u8,
}

#[account]
pub struct Bet {
    pub round_id: u64,
    pub user: Pubkey,
    pub choice: AIChoice,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoundStatus {
    Active,
    InProgress,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AIChoice {
    Alpha,
    Beta,
    Draw,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Up,
    Right,
    Down,
    Left,
}

#[error_code]
pub enum MagicBetError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid round id")]
    InvalidRoundId,
    #[msg("Invalid round duration")]
    InvalidDuration,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Round is not active")]
    RoundNotActive,
    #[msg("Round is not in progress")]
    RoundNotInProgress,
    #[msg("Round is not settled")]
    RoundNotSettled,
    #[msg("Round winner already resolved")]
    RoundAlreadyResolved,
    #[msg("Bet amount is below 0.01 SOL")]
    BetAmountTooLow,
    #[msg("Bet amount exceeds 1 SOL")]
    BetAmountTooHigh,
    #[msg("Bet choice cannot be changed after first bet")]
    BetChoiceImmutable,
    #[msg("Invalid bet choice")]
    InvalidBetChoice,
    #[msg("Bet already claimed")]
    AlreadyClaimed,
    #[msg("Bet is not a winner")]
    DidNotWin,
    #[msg("Draw round has no payout")]
    DrawNoPayout,
    #[msg("House has insufficient balance for this bet/payout")]
    InsufficientHouseFunds,
    #[msg("Winning bet must be claimed before closing")]
    UnclaimedWinningBet,
    #[msg("Invalid board setup")]
    InvalidBoardSetup,
}

#[derive(Clone)]
struct SnakeRuntime {
    board: [u8; BOARD_CELLS],
    seed: u64,
    score: u32,
    alive: bool,
    head: u16,
    food: u16,
    dir: Direction,
    death_move: Option<u32>,
}

impl SnakeRuntime {
    fn from_alpha(round: &Round) -> Self {
        Self {
            board: round.alpha_board,
            seed: round.alpha_seed,
            score: round.alpha_score,
            alive: round.alpha_alive,
            head: round.alpha_head,
            food: round.alpha_food,
            dir: round.alpha_dir,
            death_move: round.alpha_death_move,
        }
    }

    fn from_beta(round: &Round) -> Self {
        Self {
            board: round.beta_board,
            seed: round.beta_seed,
            score: round.beta_score,
            alive: round.beta_alive,
            head: round.beta_head,
            food: round.beta_food,
            dir: round.beta_dir,
            death_move: round.beta_death_move,
        }
    }

    fn write_back_alpha(self, round: &mut Round) {
        round.alpha_board = self.board;
        round.alpha_seed = self.seed;
        round.alpha_score = self.score;
        round.alpha_alive = self.alive;
        round.alpha_head = self.head;
        round.alpha_food = self.food;
        round.alpha_dir = self.dir;
        round.alpha_death_move = self.death_move;
    }

    fn write_back_beta(self, round: &mut Round) {
        round.beta_board = self.board;
        round.beta_seed = self.seed;
        round.beta_score = self.score;
        round.beta_alive = self.alive;
        round.beta_head = self.head;
        round.beta_food = self.food;
        round.beta_dir = self.dir;
        round.beta_death_move = self.death_move;
    }

    fn choose_aggressive_direction(&self) -> Option<Direction> {
        if !self.alive {
            return None;
        }

        let mut candidates = preferred_food_directions(self.head, self.food);
        candidates.push(turn_right(self.dir));
        candidates.push(turn_left(self.dir));
        candidates.push(self.dir);
        dedup_directions(&mut candidates);

        candidates
            .into_iter()
            .find(|dir| is_safe_move(&self.board, step(self.head, *dir)))
    }

    fn choose_defensive_direction(&self) -> Option<Direction> {
        if !self.alive {
            return None;
        }

        let mut best: Option<(Direction, u8, u16)> = None;

        for direction in [Direction::Up, Direction::Right, Direction::Down, Direction::Left] {
            let next = step(self.head, direction);
            if !is_safe_move(&self.board, next) {
                continue;
            }

            let next_index = match next {
                Some(value) => value,
                None => continue,
            };

            let openness = open_space_score(&self.board, next_index);
            let distance = manhattan(next_index, self.food);

            let replace = match best {
                None => true,
                Some((_, best_open, best_distance)) => {
                    openness > best_open || (openness == best_open && distance < best_distance)
                }
            };

            if replace {
                best = Some((direction, openness, distance));
            }
        }

        if let Some((direction, _, _)) = best {
            return Some(direction);
        }

        let mut fallback = preferred_food_directions(self.head, self.food);
        dedup_directions(&mut fallback);

        fallback
            .into_iter()
            .find(|dir| is_safe_move(&self.board, step(self.head, *dir)))
    }

    fn apply_move(&mut self, direction: Option<Direction>, move_number: u32) {
        if !self.alive {
            return;
        }

        let direction = match direction {
            Some(value) => value,
            None => {
                self.mark_dead(move_number);
                return;
            }
        };

        decay_board(&mut self.board);

        let next = step(self.head, direction);
        let next_index = match next {
            Some(value) => value,
            None => {
                self.mark_dead(move_number);
                return;
            }
        };

        if is_snake(self.board[next_index as usize]) {
            self.mark_dead(move_number);
            return;
        }

        let ate_food = self.board[next_index as usize] == CELL_FOOD || next_index == self.food;
        self.board[next_index as usize] = SNAKE_MAX;
        self.head = next_index;
        self.dir = direction;

        if ate_food {
            self.score = self.score.saturating_add(1);
            self.spawn_food();
        }
    }

    fn spawn_food(&mut self) {
        for _ in 0..BOARD_CELLS {
            self.seed = next_seed(self.seed);
            let candidate = (self.seed % BOARD_CELLS as u64) as u16;
            if self.board[candidate as usize] == CELL_EMPTY {
                self.food = candidate;
                self.board[candidate as usize] = CELL_FOOD;
                return;
            }
        }

        self.food = self.head;
    }

    fn mark_dead(&mut self, move_number: u32) {
        self.alive = false;
        if self.death_move.is_none() {
            self.death_move = Some(move_number);
        }
    }
}

fn require_admin_or_agent(config: &Config, signer: Pubkey) -> Result<()> {
    if signer == config.admin || config.agent == Some(signer) {
        return Ok(());
    }
    err!(MagicBetError::Unauthorized)
}

fn make_seed(round_id: u64, salt: u64) -> u64 {
    round_id.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(salt)
}

fn next_seed(seed: u64) -> u64 {
    seed.wrapping_mul(6364136223846793005).wrapping_add(1)
}

fn initialize_round_state(round: &mut Round) -> Result<()> {
    let alpha_head = xy_to_index(3, 10).ok_or(MagicBetError::InvalidBoardSetup)?;
    let beta_head = xy_to_index(16, 10).ok_or(MagicBetError::InvalidBoardSetup)?;

    let alpha_food = initialize_snake(
        &mut round.alpha_board,
        alpha_head,
        Direction::Right,
        &mut round.alpha_seed,
    )?;
    let beta_food = initialize_snake(
        &mut round.beta_board,
        beta_head,
        Direction::Left,
        &mut round.beta_seed,
    )?;

    round.alpha_head = alpha_head;
    round.beta_head = beta_head;
    round.alpha_food = alpha_food;
    round.beta_food = beta_food;
    round.alpha_dir = Direction::Right;
    round.beta_dir = Direction::Left;

    Ok(())
}

fn initialize_snake(
    board: &mut [u8; BOARD_CELLS],
    head: u16,
    dir: Direction,
    seed: &mut u64,
) -> Result<u16> {
    board[head as usize] = SNAKE_MAX;

    let mut segment = head;
    for value in [SNAKE_MAX - 1, SNAKE_MAX - 2] {
        segment = step(segment, opposite(dir)).ok_or(MagicBetError::InvalidBoardSetup)?;
        board[segment as usize] = value;
    }

    for _ in 0..BOARD_CELLS {
        *seed = next_seed(*seed);
        let candidate = (*seed % BOARD_CELLS as u64) as u16;
        if board[candidate as usize] == CELL_EMPTY {
            board[candidate as usize] = CELL_FOOD;
            return Ok(candidate);
        }
    }

    Err(MagicBetError::InvalidBoardSetup.into())
}

fn determine_winner(round: &Round, force: bool) -> Option<AIChoice> {
    if round.alpha_alive && !round.beta_alive {
        return Some(AIChoice::Alpha);
    }
    if round.beta_alive && !round.alpha_alive {
        return Some(AIChoice::Beta);
    }

    if round.alpha_alive && round.beta_alive {
        if !force {
            return None;
        }

        if round.alpha_score > round.beta_score {
            return Some(AIChoice::Alpha);
        }
        if round.beta_score > round.alpha_score {
            return Some(AIChoice::Beta);
        }
        return Some(AIChoice::Draw);
    }

    if round.alpha_score > round.beta_score {
        return Some(AIChoice::Alpha);
    }
    if round.beta_score > round.alpha_score {
        return Some(AIChoice::Beta);
    }

    match (round.alpha_death_move, round.beta_death_move) {
        (Some(alpha), Some(beta)) if alpha > beta => Some(AIChoice::Alpha),
        (Some(alpha), Some(beta)) if beta > alpha => Some(AIChoice::Beta),
        _ => Some(AIChoice::Draw),
    }
}

fn max_round_moves(duration: i64) -> u32 {
    let duration_moves = duration.saturating_mul(10);
    let bounded = duration_moves.clamp(1, MAX_MOVES as i64);
    bounded as u32
}

fn preferred_food_directions(head: u16, food: u16) -> Vec<Direction> {
    let (hx, hy) = index_to_xy(head);
    let (fx, fy) = index_to_xy(food);

    let dx = fx - hx;
    let dy = fy - hy;

    let mut directions = Vec::with_capacity(4);

    if dx.abs() >= dy.abs() {
        if dx > 0 {
            directions.push(Direction::Right);
        } else if dx < 0 {
            directions.push(Direction::Left);
        }

        if dy > 0 {
            directions.push(Direction::Down);
        } else if dy < 0 {
            directions.push(Direction::Up);
        }
    } else {
        if dy > 0 {
            directions.push(Direction::Down);
        } else if dy < 0 {
            directions.push(Direction::Up);
        }

        if dx > 0 {
            directions.push(Direction::Right);
        } else if dx < 0 {
            directions.push(Direction::Left);
        }
    }

    directions
}

fn dedup_directions(directions: &mut Vec<Direction>) {
    let mut deduped = Vec::with_capacity(directions.len());
    for direction in directions.iter().copied() {
        if !deduped.contains(&direction) {
            deduped.push(direction);
        }
    }
    *directions = deduped;
}

fn decay_board(board: &mut [u8; BOARD_CELLS]) {
    for cell in board.iter_mut() {
        if is_snake(*cell) {
            *cell = cell.saturating_sub(1);
            if *cell < SNAKE_MIN {
                *cell = CELL_EMPTY;
            }
        }
    }
}

fn open_space_score(board: &[u8; BOARD_CELLS], from: u16) -> u8 {
    let mut score = 0u8;
    for direction in [Direction::Up, Direction::Right, Direction::Down, Direction::Left] {
        if is_safe_move(board, step(from, direction)) {
            score = score.saturating_add(1);
        }
    }
    score
}

fn is_safe_move(board: &[u8; BOARD_CELLS], next: Option<u16>) -> bool {
    let next = match next {
        Some(value) => value,
        None => return false,
    };

    !is_snake(board[next as usize])
}

fn is_snake(value: u8) -> bool {
    value >= SNAKE_MIN
}

fn manhattan(a: u16, b: u16) -> u16 {
    let (ax, ay) = index_to_xy(a);
    let (bx, by) = index_to_xy(b);
    ((ax - bx).abs() + (ay - by).abs()) as u16
}

fn index_to_xy(index: u16) -> (i16, i16) {
    let x = (index as usize % BOARD_SIZE) as i16;
    let y = (index as usize / BOARD_SIZE) as i16;
    (x, y)
}

fn xy_to_index(x: i16, y: i16) -> Option<u16> {
    if x < 0 || y < 0 || x >= BOARD_SIZE as i16 || y >= BOARD_SIZE as i16 {
        return None;
    }
    Some((y as usize * BOARD_SIZE + x as usize) as u16)
}

fn step(index: u16, direction: Direction) -> Option<u16> {
    let (x, y) = index_to_xy(index);
    let (dx, dy) = match direction {
        Direction::Up => (0, -1),
        Direction::Right => (1, 0),
        Direction::Down => (0, 1),
        Direction::Left => (-1, 0),
    };
    xy_to_index(x + dx, y + dy)
}

fn opposite(direction: Direction) -> Direction {
    match direction {
        Direction::Up => Direction::Down,
        Direction::Right => Direction::Left,
        Direction::Down => Direction::Up,
        Direction::Left => Direction::Right,
    }
}

fn turn_right(direction: Direction) -> Direction {
    match direction {
        Direction::Up => Direction::Right,
        Direction::Right => Direction::Down,
        Direction::Down => Direction::Left,
        Direction::Left => Direction::Up,
    }
}

fn turn_left(direction: Direction) -> Direction {
    match direction {
        Direction::Up => Direction::Left,
        Direction::Right => Direction::Up,
        Direction::Down => Direction::Right,
        Direction::Left => Direction::Down,
    }
}
