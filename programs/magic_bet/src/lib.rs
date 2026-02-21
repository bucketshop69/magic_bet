use anchor_lang::prelude::*;

declare_id!("DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2");

#[program]
pub mod magic_bet {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
