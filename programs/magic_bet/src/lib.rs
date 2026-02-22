use anchor_lang::prelude::*;
use anchor_lang::system_program;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

// ```

// **3. SOL/USD oracle address on MagicBlock devnet:**
// ```
// ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu

declare_id!("DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2");

const ROUND_SPACE: usize = 67;
const BET_SPACE: usize = 59;
const CONFIG_SPACE: usize = 41;
#[ephemeral]
#[program]
pub mod magic_bet {

    use super::*;

    pub fn delegate_round(ctx: Context<DelegateRound>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[b"round"],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn initialize(ctx: Context<Initialize>, fund_amount: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.signer.key();
        config.bump = ctx.bumps.config;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.house.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, fund_amount)?;
        Ok(())
    }

    pub fn create_round(ctx: Context<CreateRound>, round_id: u64, duration: i64) -> Result<()> {
        let round = &mut ctx.accounts.round;

        let price_update = PriceUpdateV2::try_deserialize_unchecked(
            &mut (*ctx.accounts.price_update.data.borrow()).as_ref(),
        )
        .map_err(|_| MagicBetError::InvalidOracle)?;

        let feed_id: [u8; 32] = ctx.accounts.price_update.key().to_bytes();
        let price = price_update
            .get_price_no_older_than(&Clock::get()?, 60, &feed_id)
            .map_err(|_| MagicBetError::StalePrice)?;

        round.round_id = round_id;
        round.duration = duration;
        round.start_time = Clock::get()?.unix_timestamp;
        round.start_price = price.price;
        round.end_price = 0;
        round.status = RoundStatus::Active;
        round.up_pool = 0;
        round.down_pool = 0;
        round.bump = ctx.bumps.round;
        Ok(())
    }

    pub fn settle_and_undelegate(ctx: Context<SettleAndUndelegate>, _round_id: u64) -> Result<()> {
        let price_update = PriceUpdateV2::try_deserialize_unchecked(
            &mut (*ctx.accounts.price_update.data.borrow()).as_ref(),
        )
        .map_err(|_| MagicBetError::InvalidOracle)?;

        let feed_id: [u8; 32] = ctx.accounts.price_update.key().to_bytes();
        let price = price_update
            .get_price_no_older_than(&Clock::get()?, 60, &feed_id)
            .map_err(|_| MagicBetError::StalePrice)?;

        let round = &mut ctx.accounts.round;
        let config = &ctx.accounts.config;

        require!(
            config.admin == ctx.accounts.payer.key(),
            MagicBetError::Unauthorized
        );
        require!(
            round.status == RoundStatus::InProgress,
            MagicBetError::RoundNotInProgress
        );

        round.end_price = price.price;
        round.winning_direction = if price.price > round.start_price {
            Direction::Up
        } else {
            Direction::Down
        };
        round.status = RoundStatus::Settled;
        round.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.round.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    pub fn settle_round(ctx: Context<SettleRound>, _round_id: u64, end_price: i64) -> Result<()> {
        let round = &mut ctx.accounts.round;
        let config = &ctx.accounts.config;

        require!(
            config.admin == ctx.accounts.signer.key(),
            MagicBetError::Unauthorized
        );
        require!(
            round.status == RoundStatus::InProgress,
            MagicBetError::RoundNotInProgress
        );

        round.end_price = end_price;

        round.winning_direction = if end_price > round.start_price {
            Direction::Up
        } else {
            Direction::Down
        };

        round.status = RoundStatus::Settled;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>, _round_id: u64) -> Result<()> {
        let round = &ctx.accounts.round;
        let bet = &mut ctx.accounts.bet;

        require!(
            round.status == RoundStatus::Settled,
            MagicBetError::RoundNotSettled
        );
        require!(!bet.is_claimed, MagicBetError::AlreadyClaimed);
        require!(
            bet.direction == round.winning_direction,
            MagicBetError::DidNotWin
        );

        let payout = bet.amount * 2;

        let house_bump = ctx.bumps.house;
        let seeds = &[b"house" as &[u8], &[house_bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.house.to_account_info(),
                to: ctx.accounts.signer.to_account_info(),
            },
            signer_seeds,
        );
        system_program::transfer(cpi_context, payout)?;

        bet.is_claimed = true;
        Ok(())
    }

    pub fn close_betting(ctx: Context<CloseBetting>, _round_id: u64) -> Result<()> {
        let round = &mut ctx.accounts.round;
        let config = &ctx.accounts.config;

        require!(
            config.admin == ctx.accounts.signer.key(),
            MagicBetError::Unauthorized
        );
        require!(
            round.status == RoundStatus::Active,
            MagicBetError::RoundNotActive
        );

        round.status = RoundStatus::InProgress;
        Ok(())
    }
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        _round_id: u64,
        amount: u64,
        direction: Direction,
    ) -> Result<()> {
        let round = &mut ctx.accounts.round;

        if round.status != RoundStatus::Active {
            return Err(MagicBetError::RoundNotActive.into());
        }
        let signer = &mut ctx.accounts.signer;
        let vault = &mut ctx.accounts.vault;

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: signer.to_account_info(),
                to: vault.to_account_info(),
            },
        );

        system_program::transfer(cpi_context, amount)?;

        match direction {
            Direction::Up => round.up_pool += amount,
            Direction::Down => round.down_pool += amount,
        }

        let bet = &mut ctx.accounts.bet;
        bet.user = ctx.accounts.signer.key();
        bet.round_id = round.round_id;
        bet.direction = direction;
        bet.amount = amount;
        bet.is_claimed = false;
        bet.bump = ctx.bumps.bet;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseBetting<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SettleAndUndelegate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: pyth price feed account
    pub price_update: AccountInfo<'info>,
    /// CHECK: magic context account
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,
    /// CHECK: magic program
    pub magic_program: AccountInfo<'info>,
}
#[delegate]
#[derive(Accounts)]
pub struct DelegateRound<'info> {
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
    /// CHECK: the pda to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"bet", &round_id.to_le_bytes()[..], signer.key().as_ref()],
        bump = bet.bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: PDA house vault that pays winners
    #[account(
    mut,
    seeds = [b"house"],
    bump
)]
    pub house: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = CONFIG_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: PDA house vault funded by admin
    #[account(
    mut,
    seeds = [b"house"],
    bump
)]
    pub house: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, amount: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init,
        payer = signer,
        space = BET_SPACE,
        seeds = [b"bet", &round_id.to_le_bytes()[..], signer.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,

    #[account(
        mut,
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump
    )]
    round: Account<'info, Round>,

    /// CHECK: this is a PDA vault that only holds SOL, no data to deserialize
    #[account(
    mut,
    seeds = [b"vault", &round_id.to_le_bytes()[..]],
    bump
)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, duration: i64)]
pub struct CreateRound<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = ROUND_SPACE,
        seeds = [b"round", &round_id.to_le_bytes()[..]],
        bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: pyth price feed account
    pub price_update: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

// ===== ENUMS =====

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum RoundStatus {
    Active,
    InProgress,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Direction {
    Up,
    Down,
}

// ===== ACCOUNTS =====

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub bump: u8,
}

#[account]
pub struct Round {
    pub round_id: u64,                // 8
    pub start_price: i64,             // 8
    pub end_price: i64,               // 8
    pub start_time: i64,              // 8
    pub duration: i64,                // 8
    pub up_pool: u64,                 // 8
    pub down_pool: u64,               // 8
    pub winning_direction: Direction, // 1
    pub status: RoundStatus,          // 1
    pub bump: u8,                     // 1
}

#[account]
pub struct Bet {
    pub user: Pubkey,         // 32
    pub round_id: u64,        // 8
    pub direction: Direction, // 1
    pub amount: u64,          // 8
    pub is_claimed: bool,     // 1
    pub bump: u8,             // 1
}

#[error_code]
pub enum MagicBetError {
    #[msg("Round is not active")]
    RoundNotActive,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Round is not in progress")]
    RoundNotInProgress,

    #[msg("Round is not settled")]
    RoundNotSettled,

    #[msg("Already claimed")]
    AlreadyClaimed,

    #[msg("You did not win this round")]
    DidNotWin,

    #[msg("Invalid oracle account")]
    InvalidOracle,

    #[msg("Price is stale")]
    StalePrice,
}
