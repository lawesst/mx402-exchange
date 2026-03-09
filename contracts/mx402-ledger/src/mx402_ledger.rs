#![no_std]

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

#[type_abi]
#[derive(ManagedVecItem, TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct BuyerDebit<M: ManagedTypeApi> {
    pub buyer: ManagedAddress<M>,
    pub amount: BigUint<M>,
}

#[type_abi]
#[derive(ManagedVecItem, TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct ProviderCredit<M: ManagedTypeApi> {
    pub provider_id: ManagedBuffer<M>,
    pub amount: BigUint<M>,
}

#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct Config<M: ManagedTypeApi> {
    pub supported_token_id: EgldOrEsdtTokenIdentifier<M>,
    pub fee_bps: u16,
    pub paused: bool,
    pub owner: ManagedAddress<M>,
    pub operator: ManagedAddress<M>,
    pub treasury_address: ManagedAddress<M>,
}

#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct SettlementBatchApplied<M: ManagedTypeApi> {
    pub total_buyer_debits: BigUint<M>,
    pub total_provider_credits: BigUint<M>,
    pub fee_amount: BigUint<M>,
}

#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct ProviderClaimed<M: ManagedTypeApi> {
    pub payout_address: ManagedAddress<M>,
    pub amount: BigUint<M>,
}

#[multiversx_sc::contract]
pub trait Mx402LedgerContract {
    #[init]
    fn init(
        &self,
        supported_token_id: EgldOrEsdtTokenIdentifier,
        fee_bps: u16,
        operator: ManagedAddress,
        treasury_address: ManagedAddress,
    ) {
        require!(supported_token_id.is_valid(), "invalid supported token");
        require!(fee_bps <= 10_000, "invalid fee bps");

        self.supported_token_id().set(&supported_token_id);
        self.fee_bps().set(fee_bps);
        self.operator().set(&operator);
        self.treasury_address().set(&treasury_address);
        self.paused().set(false);
    }

    #[payable("*")]
    #[endpoint(deposit)]
    fn deposit(&self) {
        self.require_not_paused();

        let caller = self.blockchain().get_caller();
        let payment = self.call_value().egld_or_single_esdt();
        let expected_token = self.supported_token_id().get();

        require!(payment.token_identifier == expected_token, "unsupported token");
        require!(payment.amount > 0u32, "amount must be positive");

        self.buyer_balance(&caller).update(|balance| *balance += &payment.amount);
        self.deposit_event(&caller, &payment.amount);
    }

    #[endpoint(withdraw)]
    fn withdraw(&self, amount: BigUint) {
        self.require_not_paused();
        require!(amount > 0u32, "amount must be positive");

        let caller = self.blockchain().get_caller();
        self.buyer_balance(&caller).update(|balance| {
            require!(*balance >= amount, "insufficient balance");
            *balance -= &amount;
        });

        let token = self.supported_token_id().get();
        self.send().direct(&caller, &token, 0, &amount);
        self.withdraw_event(&caller, &amount);
    }

    #[only_owner]
    #[endpoint(registerProvider)]
    fn register_provider(&self, provider_id: ManagedBuffer, payout_address: ManagedAddress) {
        require!(!provider_id.is_empty(), "provider id required");
        require!(
            self.provider_payout_address(&provider_id).is_empty(),
            "provider already registered"
        );

        self.provider_payout_address(&provider_id).set(&payout_address);
        self.provider_registered_event(&provider_id, &payout_address);
    }

    #[only_owner]
    #[endpoint(updateProviderPayout)]
    fn update_provider_payout(&self, provider_id: ManagedBuffer, payout_address: ManagedAddress) {
        require!(!self.provider_payout_address(&provider_id).is_empty(), "provider not found");

        self.provider_payout_address(&provider_id).set(&payout_address);
        self.provider_payout_updated_event(&provider_id, &payout_address);
    }

    #[endpoint(applySettlementBatch)]
    fn apply_settlement_batch(
        &self,
        batch_id: ManagedBuffer,
        buyer_debits: ManagedVec<Self::Api, BuyerDebit<Self::Api>>,
        provider_credits: ManagedVec<Self::Api, ProviderCredit<Self::Api>>,
        fee_amount: BigUint,
    ) {
        self.require_not_paused();
        self.require_operator();
        require!(!batch_id.is_empty(), "batch id required");
        require!(!self.processed_batch(&batch_id).get(), "batch already processed");

        let mut total_buyer_debits = BigUint::zero();
        let mut total_provider_credits = BigUint::zero();

        for debit in buyer_debits.into_iter() {
            require!(debit.amount > 0u32, "buyer debit must be positive");
            let amount = debit.amount;
            self.buyer_balance(&debit.buyer).update(|balance| {
                require!(*balance >= amount, "buyer balance too low");
                *balance -= &amount;
            });
            total_buyer_debits += amount;
        }

        for credit in provider_credits.into_iter() {
            require!(credit.amount > 0u32, "provider credit must be positive");
            require!(
                !self.provider_payout_address(&credit.provider_id).is_empty(),
                "provider not registered"
            );

            let amount = credit.amount;
            self.provider_claimable(&credit.provider_id)
                .update(|claimable| *claimable += &amount);
            total_provider_credits += amount;
        }

        require!(
            total_buyer_debits == total_provider_credits.clone() + &fee_amount,
            "batch totals mismatch"
        );

        if fee_amount > 0u32 {
            let token = self.supported_token_id().get();
            let treasury_address = self.treasury_address().get();
            self.send().direct(&treasury_address, &token, 0, &fee_amount);
        }

        self.processed_batch(&batch_id).set(true);
        let event_payload = SettlementBatchApplied {
            total_buyer_debits,
            total_provider_credits,
            fee_amount,
        };
        self.settlement_batch_applied_event(
            &batch_id,
            &event_payload,
        );
    }

    #[endpoint(claimProviderEarnings)]
    fn claim_provider_earnings(
        &self,
        provider_id: ManagedBuffer,
        opt_amount: OptionalValue<BigUint>,
    ) {
        self.require_not_paused();

        let caller = self.blockchain().get_caller();
        let payout_address = self.provider_payout_address(&provider_id).get();
        require!(caller == payout_address, "caller is not payout address");

        let amount = match opt_amount {
            OptionalValue::Some(value) => value,
            OptionalValue::None => self.provider_claimable(&provider_id).get(),
        };

        require!(amount > 0u32, "amount must be positive");

        self.provider_claimable(&provider_id).update(|claimable| {
            require!(*claimable >= amount, "insufficient claimable balance");
            *claimable -= &amount;
        });

        let token = self.supported_token_id().get();
        self.send().direct(&caller, &token, 0, &amount);
        let event_payload = ProviderClaimed {
            payout_address: caller,
            amount,
        };
        self.provider_claimed_event(&provider_id, &event_payload);
    }

    #[only_owner]
    #[endpoint(setFeeBps)]
    fn set_fee_bps(&self, fee_bps: u16) {
        require!(fee_bps <= 10_000, "invalid fee bps");
        self.fee_bps().set(fee_bps);
    }

    #[only_owner]
    #[endpoint(setOperator)]
    fn set_operator(&self, operator: ManagedAddress) {
        self.operator().set(&operator);
    }

    #[only_owner]
    #[endpoint(setTreasuryAddress)]
    fn set_treasury_address(&self, treasury_address: ManagedAddress) {
        self.treasury_address().set(&treasury_address);
    }

    #[only_owner]
    #[endpoint(pause)]
    fn pause(&self) {
        self.paused().set(true);
    }

    #[only_owner]
    #[endpoint(unpause)]
    fn unpause(&self) {
        self.paused().set(false);
    }

    #[view(getConfig)]
    fn get_config(&self) -> Config<Self::Api> {
        Config {
            supported_token_id: self.supported_token_id().get(),
            fee_bps: self.fee_bps().get(),
            paused: self.paused().get(),
            owner: self.blockchain().get_owner_address(),
            operator: self.operator().get(),
            treasury_address: self.treasury_address().get(),
        }
    }

    #[view(hasProvider)]
    fn has_provider(&self, provider_id: ManagedBuffer) -> bool {
        !self.provider_payout_address(&provider_id).is_empty()
    }

    #[view(getFeeBps)]
    fn get_fee_bps(&self) -> u16 {
        self.fee_bps().get()
    }

    fn require_operator(&self) {
        require!(
            self.blockchain().get_caller() == self.operator().get(),
            "caller is not operator"
        );
    }

    fn require_not_paused(&self) {
        require!(!self.paused().get(), "contract paused");
    }

    #[event("deposit")]
    fn deposit_event(&self, #[indexed] buyer: &ManagedAddress, amount: &BigUint);

    #[event("withdraw")]
    fn withdraw_event(&self, #[indexed] buyer: &ManagedAddress, amount: &BigUint);

    #[event("provider_registered")]
    fn provider_registered_event(
        &self,
        #[indexed] provider_id: &ManagedBuffer,
        payout_address: &ManagedAddress,
    );

    #[event("provider_payout_updated")]
    fn provider_payout_updated_event(
        &self,
        #[indexed] provider_id: &ManagedBuffer,
        payout_address: &ManagedAddress,
    );

    #[event("settlement_batch_applied")]
    fn settlement_batch_applied_event(
        &self,
        #[indexed] batch_id: &ManagedBuffer,
        batch: &SettlementBatchApplied<Self::Api>,
    );

    #[event("provider_claimed")]
    fn provider_claimed_event(
        &self,
        #[indexed] provider_id: &ManagedBuffer,
        claim: &ProviderClaimed<Self::Api>,
    );

    #[view(getBuyerBalance)]
    #[storage_mapper("buyer_balance")]
    fn buyer_balance(&self, buyer: &ManagedAddress) -> SingleValueMapper<BigUint>;

    #[view(getProviderPayoutAddress)]
    #[storage_mapper("provider_payout_address")]
    fn provider_payout_address(
        &self,
        provider_id: &ManagedBuffer,
    ) -> SingleValueMapper<ManagedAddress>;

    #[view(getProviderClaimable)]
    #[storage_mapper("provider_claimable")]
    fn provider_claimable(&self, provider_id: &ManagedBuffer) -> SingleValueMapper<BigUint>;

    #[view(isBatchProcessed)]
    #[storage_mapper("processed_batch")]
    fn processed_batch(&self, batch_id: &ManagedBuffer) -> SingleValueMapper<bool>;

    #[storage_mapper("supported_token_id")]
    fn supported_token_id(&self) -> SingleValueMapper<EgldOrEsdtTokenIdentifier>;

    #[storage_mapper("fee_bps")]
    fn fee_bps(&self) -> SingleValueMapper<u16>;

    #[storage_mapper("paused")]
    fn paused(&self) -> SingleValueMapper<bool>;

    #[storage_mapper("operator")]
    fn operator(&self) -> SingleValueMapper<ManagedAddress>;

    #[storage_mapper("treasury_address")]
    fn treasury_address(&self) -> SingleValueMapper<ManagedAddress>;
}
