import { useEffect, useState } from "react";
import TxState from "./TxState.jsx";
import { useTx } from "../hooks/useTx.js";
import { fundVaultCollateral, fundVaultCall, readWalletCollateral } from "../chain/vault.js";
import { checkGas } from "../chain/preflight.js";
import { TEST_TOKEN_HELP } from "../chain/preflight.js";

const usd = (raw) => `$${(Number(raw ?? 0n) / 1e6).toFixed(2)}`;

// Putting money into the trading account.
//
// The old flow printed the account's address and left the trader to open their
// wallet, find the token and send it by hand. Sequence knows the address, the
// token and the amount, so it builds the transfer and the wallet just signs it.
// The address is still available, one disclosure away, for anyone who wants to
// send from somewhere else.
export default function FundPanel({ wallet, vault, required = 0n, onFunded, compact = false }) {
  const [walletUsdc, setWalletUsdc] = useState(null);
  const [amount, setAmount] = useState("");
  const [showAddress, setShowAddress] = useState(false);
  const tx = useTx();

  const held = vault.state?.bankroll ?? 0n;
  const short = required > held ? required - held : 0n;

  useEffect(() => {
    let live = true;
    readWalletCollateral(wallet.account).then((b) => live && setWalletUsdc(b)).catch(() => {});
    return () => { live = false; };
  }, [wallet.account, vault.state?.bankroll, tx.phase]);

  // Default to what this sequence actually needs, not a round number we invented.
  useEffect(() => {
    if (amount === "" && short > 0n) setAmount((Number(short) / 1e6).toFixed(2));
  }, [short, amount]);

  const value = BigInt(Math.max(0, Math.round(Number(amount || 0) * 1e6)));
  const hasWalletFunds = walletUsdc !== null && walletUsdc > 0n;
  const overWallet = walletUsdc !== null && value > walletUsdc;
  const canFund = wallet.connected && wallet.onShannon && value > 0n && !overWallet && hasWalletFunds && !tx.busy && vault.address;

  const fund = async () => {
    const r = await tx.run({
      preflight: () => checkGas({
        account: wallet.account,
        contract: fundVaultCall({ vault: vault.address, amount: value }),
      }),
      send: (onHash) => fundVaultCollateral({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, amount: value, onHash,
      }),
    });
    if (r.ok) {
      await vault.refresh();
      setAmount("");
      onFunded?.(r.result);
    }
  };

  return (
    <div className={compact ? "" : "workspace-card p-7"}>
      {!compact && (
        <>
          <div className="micro-label">Funding</div>
          <h3 className="mt-2 text-[18px] font-extrabold tracking-[-.04em] text-[#151318]">Move funds into your account</h3>
        </>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
          <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">Your wallet</div>
          <div className="mt-1 text-[16px] font-extrabold text-[#28252c]">
            {walletUsdc === null ? "…" : usd(walletUsdc)}
          </div>
        </div>
        <div className="rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
          <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">Sequence account</div>
          <div className="mt-1 text-[16px] font-extrabold text-[#28252c]">{usd(held)}</div>
        </div>
      </div>

      {short > 0n && (
        <p className="mt-3 text-[11px] leading-[1.7] text-[#8a6a34]">
          This sequence can put up to <strong className="font-bold">{usd(required)}</strong> at risk. Your account holds{" "}
          <strong className="font-bold">{usd(held)}</strong>. Fund at least <strong className="font-bold">{usd(short)}</strong> to run it.
        </p>
      )}

      {/* Nothing to fund from. This is the only place a faucet belongs: a wallet
          that actually has nothing. */}
      {walletUsdc !== null && !hasWalletFunds ? (
        <div className="mt-4 rounded-sm border border-[#f0dcc6] bg-[#fdf8f1] p-4">
          <div className="text-[11px] font-bold text-[#8a6a34]">Your wallet holds no test USDC</div>
          <p className="mt-1.5 text-[10px] leading-[1.65] text-[#7d6b52]">{TEST_TOKEN_HELP.usdc}</p>
        </div>
      ) : (
        <>
          <label className="mt-4 block max-w-[240px]">
            <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">Amount to fund</span>
            <div className="input-prefix">
              <span>$</span>
              <input
                type="number" step="1" min="0" aria-label="Amount to fund"
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </label>
          {overWallet && (
            <p className="mt-2 text-[10px] font-semibold text-[#dc6e58]">
              That is more than the {usd(walletUsdc)} your wallet holds.
            </p>
          )}

          <button onClick={fund} disabled={!canFund} className="soft-button mt-4 bg-[#111014] px-5 py-2.5 text-white disabled:opacity-35">
            {tx.busy ? "Funding…" : "Fund Sequence"}
          </button>
          <TxState tx={tx} labels={{
            signing: "Waiting for you to approve the transfer in your wallet.",
            success: "Funded. Your account balance is updated.",
          }} />
        </>
      )}

      {/* Advanced only. A normal trader never needs to see this. */}
      <button onClick={() => setShowAddress((v) => !v)} className="mt-4 block text-[10px] font-bold text-[#a8a2ad] hover:text-[#6f58c2]">
        {showAddress ? "Hide account address" : "Receive manually / account address"}
      </button>
      {showAddress && (
        <div className="mt-2 rounded-sm bg-[#f8f7fc] p-3">
          <code className="block break-all font-mono text-[9px] text-[#4b4650]">{vault.address || "No account yet"}</code>
          <p className="mt-1.5 text-[9px] leading-[1.6] text-[#8b8590]">
            Send test USDC here from anywhere. Only send tokens on Somnia Shannon.
          </p>
        </div>
      )}
    </div>
  );
}
