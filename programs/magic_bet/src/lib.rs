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
const MAX_MOVES: u32 = 300;

const CELL_EMPTY: u8 = 0;
const CELL_WALL: u8 = 1;
const CELL_FOOD: u8 = 2;
const SNAKE_MIN: u8 = 3;
const SNAKE_MAX: u8 = 8;

const FOOD_MIRROR_UNTIL_MOVE: u32 = 120;
const SHRINK_START_MOVE: u32 = 150;
const SHRINK_INTERVAL: u32 = 30;

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
        let beta_direction = beta.choose_aggressive_direction();

        let alpha_ate = alpha.apply_move(alpha_direction, move_number);
        let beta_ate = beta.apply_move(beta_direction, move_number);

        if should_use_mirrored_food(move_number) {
            if alpha_ate || beta_ate {
                respawn_symmetric_food(&mut alpha, &mut beta)?;
            }
        } else {
            if alpha_ate {
                respawn_food_single(&mut alpha)?;
            }
            if beta_ate {
                respawn_food_single(&mut beta)?;
            }
        }

        apply_shrink_to_runtime(&mut alpha, move_number)?;
        apply_shrink_to_runtime(&mut beta, move_number)?;
        ensure_food_present(&mut alpha)?;
        ensure_food_present(&mut beta)?;

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

    fn apply_move(&mut self, direction: Option<Direction>, move_number: u32) -> bool {
        if !self.alive {
            return false;
        }

        let direction = match direction {
            Some(value) => value,
            None => {
                self.mark_dead(move_number);
                return false;
            }
        };

        let next = step(self.head, direction);
        let next_index = match next {
            Some(value) => value,
            None => {
                self.mark_dead(move_number);
                return false;
            }
        };

        let ate_food = self.board[next_index as usize] == CELL_FOOD || next_index == self.food;

        // Snake grows on food by skipping one decay cycle.
        if !ate_food {
            decay_board(&mut self.board);
        }

        if is_snake(self.board[next_index as usize]) {
            self.mark_dead(move_number);
            return false;
        }

        self.board[next_index as usize] = SNAKE_MAX;
        self.head = next_index;
        self.dir = direction;

        if ate_food {
            self.score = self.score.saturating_add(1);
            return true;
        }

        false
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
    let beta_head = mirror_index(alpha_head);

    initialize_snake(&mut round.alpha_board, alpha_head, Direction::Right)?;
    initialize_snake(&mut round.beta_board, beta_head, Direction::Left)?;

    round.alpha_head = alpha_head;
    round.beta_head = beta_head;
    round.alpha_food = alpha_head;
    round.beta_food = beta_head;
    round.alpha_dir = Direction::Right;
    round.beta_dir = Direction::Left;

    let mut alpha = SnakeRuntime::from_alpha(round);
    let mut beta = SnakeRuntime::from_beta(round);
    respawn_symmetric_food(&mut alpha, &mut beta)?;
    alpha.write_back_alpha(round);
    beta.write_back_beta(round);

    Ok(())
}

fn initialize_snake(board: &mut [u8; BOARD_CELLS], head: u16, dir: Direction) -> Result<()> {
    board[head as usize] = SNAKE_MAX;

    let mut segment = head;
    for value in [SNAKE_MAX - 1, SNAKE_MAX - 2] {
        segment = step(segment, opposite(dir)).ok_or(MagicBetError::InvalidBoardSetup)?;
        board[segment as usize] = value;
    }

    Ok(())
}

fn respawn_symmetric_food(alpha: &mut SnakeRuntime, beta: &mut SnakeRuntime) -> Result<()> {
    clear_food_if_present(&mut alpha.board, alpha.food);
    clear_food_if_present(&mut beta.board, beta.food);

    for _ in 0..BOARD_CELLS {
        alpha.seed = next_seed(alpha.seed);
        let alpha_candidate = (alpha.seed % BOARD_CELLS as u64) as u16;
        let beta_candidate = mirror_index(alpha_candidate);
        if alpha.board[alpha_candidate as usize] == CELL_EMPTY
            && beta.board[beta_candidate as usize] == CELL_EMPTY
        {
            alpha.food = alpha_candidate;
            beta.food = beta_candidate;
            alpha.board[alpha_candidate as usize] = CELL_FOOD;
            beta.board[beta_candidate as usize] = CELL_FOOD;
            return Ok(());
        }
    }

    Err(MagicBetError::InvalidBoardSetup.into())
}

fn respawn_food_single(runtime: &mut SnakeRuntime) -> Result<()> {
    clear_food_if_present(&mut runtime.board, runtime.food);

    for _ in 0..BOARD_CELLS {
        runtime.seed = next_seed(runtime.seed);
        let candidate = (runtime.seed % BOARD_CELLS as u64) as u16;
        if runtime.board[candidate as usize] == CELL_EMPTY {
            runtime.food = candidate;
            runtime.board[candidate as usize] = CELL_FOOD;
            return Ok(());
        }
    }

    Err(MagicBetError::InvalidBoardSetup.into())
}

fn ensure_food_present(runtime: &mut SnakeRuntime) -> Result<()> {
    if runtime.board[runtime.food as usize] == CELL_FOOD {
        return Ok(());
    }
    respawn_food_single(runtime)
}

fn clear_food_if_present(board: &mut [u8; BOARD_CELLS], index: u16) {
    if board[index as usize] == CELL_FOOD {
        board[index as usize] = CELL_EMPTY;
    }
}

fn should_use_mirrored_food(move_number: u32) -> bool {
    move_number <= FOOD_MIRROR_UNTIL_MOVE
}

fn shrink_level(move_number: u32) -> i16 {
    if move_number < SHRINK_START_MOVE {
        return 0;
    }
    let levels = 1 + ((move_number - SHRINK_START_MOVE) / SHRINK_INTERVAL) as i16;
    let max_level = (BOARD_SIZE as i16 / 2) - 1;
    levels.min(max_level)
}

fn is_in_shrunk_wall(index: u16, level: i16) -> bool {
    if level <= 0 {
        return false;
    }
    let (x, y) = index_to_xy(index);
    let max = BOARD_SIZE as i16 - level;
    x < level || y < level || x >= max || y >= max
}

fn apply_shrink_to_runtime(runtime: &mut SnakeRuntime, move_number: u32) -> Result<()> {
    let level = shrink_level(move_number);
    if level <= 0 {
        return Ok(());
    }

    for index in 0..BOARD_CELLS as u16 {
        if is_in_shrunk_wall(index, level) {
            runtime.board[index as usize] = CELL_WALL;
        }
    }

    if runtime.alive && is_in_shrunk_wall(runtime.head, level) {
        runtime.mark_dead(move_number);
    }

    if runtime.board[runtime.food as usize] == CELL_WALL {
        respawn_food_single(runtime)?;
    }

    Ok(())
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

    let cell = board[next as usize];
    !is_snake(cell) && cell != CELL_WALL
}

fn is_snake(value: u8) -> bool {
    value >= SNAKE_MIN
}

fn manhattan(a: u16, b: u16) -> u16 {
    let (ax, ay) = index_to_xy(a);
    let (bx, by) = index_to_xy(b);
    ((ax - bx).abs() + (ay - by).abs()) as u16
}

fn mirror_index(index: u16) -> u16 {
    let (x, y) = index_to_xy(index);
    let mirrored_x = (BOARD_SIZE as i16 - 1) - x;
    xy_to_index(mirrored_x, y).unwrap_or(index)
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

#[cfg(test)]
mod simulation_tests {
    use super::*;

    fn blank_round(round_id: u64, duration: i64) -> Round {
        Round {
            round_id,
            status: RoundStatus::InProgress,
            winner: None,
            alpha_board: [CELL_EMPTY; BOARD_CELLS],
            beta_board: [CELL_EMPTY; BOARD_CELLS],
            alpha_seed: make_seed(round_id, 0xA11A_A11A_A11A_A11A),
            beta_seed: make_seed(round_id, 0xB37A_B37A_B37A_B37A),
            alpha_score: 0,
            beta_score: 0,
            alpha_alive: true,
            beta_alive: true,
            move_count: 0,
            alpha_pool: 0,
            beta_pool: 0,
            start_time: 0,
            end_time: None,
            duration,
            alpha_head: 0,
            beta_head: 0,
            alpha_food: 0,
            beta_food: 0,
            alpha_dir: Direction::Right,
            beta_dir: Direction::Left,
            alpha_death_move: None,
            beta_death_move: None,
            bump: 0,
        }
    }

    fn simulate_round(round_id: u64, duration: i64) -> AIChoice {
        let mut round = blank_round(round_id, duration);
        initialize_round_state(&mut round).expect("round init should succeed");

        for _ in 0..max_round_moves(duration) {
            let move_number = round.move_count.saturating_add(1);
            let mut alpha = SnakeRuntime::from_alpha(&round);
            let mut beta = SnakeRuntime::from_beta(&round);

            let alpha_direction = alpha.choose_aggressive_direction();
            let beta_direction = beta.choose_aggressive_direction();
            let alpha_ate = alpha.apply_move(alpha_direction, move_number);
            let beta_ate = beta.apply_move(beta_direction, move_number);
            if should_use_mirrored_food(move_number) {
                if alpha_ate || beta_ate {
                    respawn_symmetric_food(&mut alpha, &mut beta)
                        .expect("symmetric food respawn should succeed");
                }
            } else {
                if alpha_ate {
                    respawn_food_single(&mut alpha).expect("alpha food respawn should succeed");
                }
                if beta_ate {
                    respawn_food_single(&mut beta).expect("beta food respawn should succeed");
                }
            }

            apply_shrink_to_runtime(&mut alpha, move_number).expect("alpha shrink should succeed");
            apply_shrink_to_runtime(&mut beta, move_number).expect("beta shrink should succeed");
            ensure_food_present(&mut alpha).expect("alpha food should exist");
            ensure_food_present(&mut beta).expect("beta food should exist");

            alpha.write_back_alpha(&mut round);
            beta.write_back_beta(&mut round);
            round.move_count = move_number;

            if let Some(winner) = determine_winner(&round, false) {
                return winner;
            }
        }

        determine_winner(&round, true).unwrap_or(AIChoice::Draw)
    }

    #[test]
    fn fairness_snapshot_500_rounds() {
        let mut alpha = 0u32;
        let mut beta = 0u32;
        let mut draw = 0u32;

        for round_id in 1..=500 {
            match simulate_round(round_id, 45) {
                AIChoice::Alpha => alpha += 1,
                AIChoice::Beta => beta += 1,
                AIChoice::Draw => draw += 1,
            }
        }

        println!(
            "fairness snapshot => alpha: {alpha}, beta: {beta}, draw: {draw}"
        );
        assert_eq!(alpha + beta + draw, 500);
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
