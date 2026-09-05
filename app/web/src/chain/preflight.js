// Checks that run before a wallet is ever opened.
//
// The failure this prevents is the worst one in the product: a user presses a
// button, the wallet opens showing a fee they cannot pay or a request their
// wallet cannot simulate, and the app sits on "Approve in your wallet…" with no
// way to learn what went wrong. Everything here is read-only and cheap, and it
// runs first so the answer arrives as a sentence rather than a dead end.
import { publicClient } from "./vault.js";
import { SHANNON } from "./config.js";

// Test-token help, checked rather than assumed.
//
// `dreamdex.somnia.network` does not resolve at all, so the old "Get test USDC"
// link was a dead button. The real site is dreamdex.io, and it publishes no
// faucet path we could verify. Rather than invent a URL that sends people
// nowhere, the USDC case says plainly where the token comes from and points at a
// channel that does exist.
//
// The Somnia testnet hub is real and is what the docs name for STT, but it is a
// hub rather than a one-click faucet, so it is described as what it is.
export const FAUCET_URL = "https://testnet.somnia.network/";
export const SOMNIA_DISCORD = "https://discord.com/invite/somnia";

export const TEST_TOKEN_HELP = {
  stt: "STT is the network's own token and pays transaction fees. The Somnia testnet hub is where it is handed out; if the faucet there is not serving requests, the developer channels on Discord are the reliable route.",
  usdc: "Test USDC is the collateral DreamDEX Event Contracts trade against. There is no public faucet page we can point you to that we have verified works, so we would rather say that than send you to a dead link. Ask in Somnia's Discord developer chat and someone will fund your address.",
};

const erc20BalanceAbi = [{
  type: "function", stateMutability: "view", name: "balanceOf",
  inputs: [{ type: "address" }], outputs: [{ type: "uint256" }],
}];

export const som = (raw, dp = 3) => `${(Number(raw) / 1e18).toFixed(dp)} STT`;
export const usd = (raw) => `$${(Number(raw) / 1e6).toFixed(2)}`;

// What one transaction will cost, and whether this wallet can pay it.
//
// The gas figure is an estimate of the real call, not a guess: if the call
// itself would revert, that surfaces here as a plain reason instead of as an
// "Unknown Signature Type" in somebody's wallet.
export async function checkGas({ account, contract }) {
  const client = publicClient();
  try {
    const [balance, gasPrice, gas] = await Promise.all([
      client.getBalance({ address: account }),
      client.getGasPrice(),
      client.estimateContractGas({ ...contract, account }).catch(() => null),
    ]);

    // An empty wallet cannot even be estimated for: the node rejects the
    // estimate because the account could not pay for the gas it is asking about.
    // Reporting that as "cannot be prepared" hides the one fact that matters,
    // so the balance is checked before the estimate is trusted to mean anything.
    if (gas === null) {
      if (balance === 0n) {
        return {
          ok: false, reason: "insufficient-gas", balance, shortfall: null,
          message: "This wallet holds no test STT, so it cannot pay the network fee for this transaction.",
        };
      }
      return {
        ok: false, reason: "simulation-failed", balance,
        message: "This action cannot be prepared right now. Nothing was sent and your wallet was not opened.",
      };
    }

    // Wallets pad the fee they display, and a fee that lands a hair above the
    // balance is the same dead end as one that lands far above it.
    const cost = gas * gasPrice;
    const needed = (cost * 125n) / 100n;
    if (balance < needed) {
      return {
        ok: false, reason: "insufficient-gas", balance, cost, needed,
        shortfall: needed - balance,
        message: `This needs about ${som(needed)} for network fees and your wallet holds ${som(balance)}.`,
      };
    }
    return { ok: true, balance, cost, needed, gas, gasPrice };
  } catch (cause) {
    // A failed check must never block the user: it reports what it could not do
    // and lets them proceed, rather than inventing a reason to stop them.
    return { ok: true, unknown: true, message: cause?.shortMessage || "Could not estimate the network fee." };
  }
}

// The same question for a plain value transfer.
export async function checkGasForTransfer({ account, to, value }) {
  const client = publicClient();
  try {
    const [balance, gasPrice, gas] = await Promise.all([
      client.getBalance({ address: account }),
      client.getGasPrice(),
      client.estimateGas({ account, to, value }).catch(() => 21000n),
    ]);
    const fee = (gas * gasPrice * 125n) / 100n;
    const needed = value + fee;
    if (balance < needed) {
      return {
        ok: false, reason: "insufficient-gas", balance, needed, fee,
        shortfall: needed - balance,
        message: `This sends ${som(value)} and needs about ${som(fee)} for fees, but your wallet holds ${som(balance)}.`,
      };
    }
    return { ok: true, balance, needed, fee };
  } catch {
    return { ok: true, unknown: true };
  }
}

// Everything the setup screens need to know about a wallet's readiness, read in
// one pass so the interface can say what is missing before anything is signed.
export async function readWalletReadiness(account) {
  if (!account) return null;
  const client = publicClient();
  const [native, usdc] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({
      address: SHANNON.testUsdc, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account],
    }).catch(() => 0n),
  ]);
  return {
    native,
    usdc,
    // A vault deployment estimates around 65M gas on Shannon, so "enough for
    // gas" is a much larger number here than the usual chain intuition.
    canPayGas: native > 500000000000000000n,   // 0.5 STT
    hasCollateral: usdc > 0n,
  };
}
