use soroban_sdk::{Bytes, Env};
use ultrahonk_soroban_verifier::PROOF_BYTES;

const CONTRACT_WASM: &[u8] =
    include_bytes!("../target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm");

mod ultrahonk_contract {
    soroban_sdk::contractimport!(
        file = "target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm"
    );
}

fn register_client<'a>(env: &'a Env, vk_bytes: &Bytes) -> ultrahonk_contract::Client<'a> {
    let contract_id = env.register(CONTRACT_WASM, (vk_bytes.clone(),));
    ultrahonk_contract::Client::new(env, &contract_id)
}

#[test]
fn verify_proof_succeeds() {
    let vk_bytes_raw: &[u8] = include_bytes!("../circuit/target/vk");
    let proof_bin: &[u8] = include_bytes!("../circuit/target/proof");
    let pub_inputs_bin: &[u8] = include_bytes!("../circuit/target/public_inputs");

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    assert_eq!(proof_bin.len(), PROOF_BYTES);

    let vk_bytes = Bytes::from_slice(&env, vk_bytes_raw);
    let proof_bytes = Bytes::from_slice(&env, proof_bin);
    let public_inputs = Bytes::from_slice(&env, pub_inputs_bin);

    let client = register_client(&env, &vk_bytes);
    client.verify_proof(&public_inputs, &proof_bytes);
}
