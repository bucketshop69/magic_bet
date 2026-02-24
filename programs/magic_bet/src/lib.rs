use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2");

pub const TEST_PDA_SEED: &[u8] = b"counter_pda_v2";

#[ephemeral]
#[program]
pub mod anchor_counter {
    use super::*;

    /// Initialize the counter (on L1 - no ER needed)
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("[L1] Initialized counter to 0");
        Ok(())
    }

    /// Increment the counter (on L1 - no ER)
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("[L1] Incremented counter to {}", counter.count);
        Ok(())
    }

    /// Delegate the counter PDA to the Ephemeral Rollup
    /// This is called on L1, transfers ownership to delegation program
    pub fn delegate(ctx: Context<DelegateInput>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[TEST_PDA_SEED],
            DelegateConfig {
                // Use the validator from remaining_accounts
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("[L1] Delegated counter to ER");
        Ok(())
    }

    /// Commit state from ER to L1 (PDA stays locked)
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("[ER] Committed state to L1");
        Ok(())
    }

    /// Undelegate and commit final state to L1 (unlocks PDA)
    pub fn undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("[ER] Undelegated and committed state to L1");
        Ok(())
    }

    /// Increment on ER and commit in one transaction
    pub fn increment_and_commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("[ER] Incremented to {}", counter.count);
        
        // Exit the account so it can be committed
        counter.exit(&crate::ID)?;
        
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("[ER] Incremented and committed to L1");
        Ok(())
    }

    /// Increment on ER and undelegate in one transaction
    pub fn increment_and_undelegate(ctx: Context<IncrementAndCommit>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        msg!("[ER] Incremented to {}", counter.count);
        
        // Exit the account so it can be committed
        counter.exit(&crate::ID)?;
        
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.counter.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("[ER] Incremented and undelegated (final commit)");
        Ok(())
    }
}

/// Context for initializing counter on L1
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Context for incrementing counter on L1
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Delegate context - uses #[delegate] macro to inject CPI logic
#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The PDA to delegate - marked with `del` for delegation
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

/// Context for ER operations (commit/undelegate) - uses #[commit] macro
#[commit]
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

/// Counter account struct
#[account]
pub struct Counter {
    pub count: u64,
}
