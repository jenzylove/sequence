import { useEffect, useState } from "react";
import ScreenHeader from "./ScreenHeader.jsx";
import TxState from "./TxState.jsx";
import { createVault, createVaultCall } from "../chain/vault.js";
import { checkGas, readWalletReadiness, FAUCET_URL } from "../chain/preflight.js";
import { useTx } from "../hooks/useTx.js";
import { money } from "../lib/language.js";

const DEFAULT_LIMIT = 5000000n; // $5.00

// What a wallet with no trading account sees.
//
// This screen used to describe ownership and a "risk ceiling" without ever
// saying what the button physically does. A first-time reader could not tell
// that they were deploying a contract, and the one number on the page looked
// like an amount they were about to send. Both are stated plainly now, before
// the wallet ever opens.
export default function Provision({ wallet, vault, onReady }) {
  const [limit, setLimit] = useState(String(Number(DEFAULT_LIMIT) / 1e6));
  const [readiness, setReadiness] = useState(null);
  const [created, setCreated] = useState(null);
  const tx = useTx();

  // Price the actual transaction up front rather than comparing the balance to a
  // guessed threshold. A vault deployment estimates tens of millions of gas on
  // Shannon, so "enough for gas" here is not the number intuition suggests, and
  // the only honest source for it is the estimate itself.
  useEffect(() => {
    let live = true;
    if (!wallet.account || !wallet.onShannon) return undefined;
    setReadiness(null);
    Promise.all([
      readWalletReadiness(wallet.account),
      checkGas({ account: wallet.account, contract: createVaultCall({ maxOutstanding: value || 1n }) }),
    ])
      .then(([balances, gas]) => live && setReadiness({ ...balances, gas }))
      .catch(() => live && setReadiness({ gas: { ok: true, unknown: true } }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.account, wallet.onShannon, created]);

  const noGas = readiness?.gas?.ok === false && readiness.gas.reason === "insufficient-gas";
  const value = BigInt(Math.max(0, Math.round(Number(limit || 0) * 1e6)));
  const validLimit = value > 0n;
  // Once we know the fee cannot be paid, offering the button is offering a
  // guaranteed failure. The warning above it already says what to do instead.
  const ready = wallet.connected && wallet.onShannon && validLimit && !tx.busy && !noGas;

  const create = async () => {
    const result = await tx.run({
      preflight: () => checkGas({
        account: wallet.account,
        contract: createVaultCall({ maxOutstanding: value }),
      }),
      send: (onHash) => createVault({
        provider: wallet.provider, account: wallet.account, maxOutstanding: value, onHash,
      }),
    });
    if (result.ok) {
      setCreated(result.result);
      vault.adopt(result.result.vault);
      onReady?.(result.result.vault);
    }
  };

  const cannotPrepare = readiness?.gas?.ok === false && readiness.gas.reason === "simulation-failed";

  return (
    <section id="provision" className="dashboard-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-14 sm:px-12 lg:px-16 lg:py-16">
        <ScreenHeader
          trail={[{ label: "Get set up" }]}
          tag="Get set up"
          title="Create your trading account."
          blurb="Sequence runs your strategy from an account of your own on the Somnia test network. Creating it publishes a small program that holds your test funds and enforces the limit you set. Only your wallet can arm it, pause it, or take anything out."
        />

        <div className="workspace-card mt-10 max-w-[720px]">
          <div className="p-7 lg:p-9">

            {/* What is actually about to happen, in the order a person asks it. */}
            <div className="rounded-sm border border-[#e6e2ee] bg-[#faf9fd] p-5">
              <div className="micro-label">What this button does</div>
              <p className="mt-2.5 text-[11px] leading-[1.75] text-[#5f5a66]">
                It sends <strong className="font-bold text-[#28252c]">one transaction</strong> that publishes your account onto the
                Somnia test network. You pay a network fee in test STT. It moves
                <strong className="font-bold text-[#28252c]"> no trading money</strong> — the account starts empty and you fund it afterwards.
              </p>
              <p className="mt-2.5 text-[11px] leading-[1.75] text-[#5f5a66]">
                This is a test network. Everything here uses test tokens with no real value.
              </p>
            </div>

            <ol className="mt-7 space-y-5">
              <Point n={1} title="It belongs to your wallet">
                Created for {wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : "your wallet"}, and owned by it from the moment it exists. Nobody else can move anything out of it, including us.
              </Point>
              <Point n={2} title="You set the most it can risk">
                A cap the account enforces on itself: no sequence can have more than this much riding on open trades at once. You can change it later.
              </Point>
              <Point n={3} title="Funding comes after">
                Once the account exists you send it test USDC to trade with. Creating it moves nothing.
              </Point>
            </ol>

            <label className="mt-8 block max-w-[300px]">
              <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">Most at risk at once</span>
              <div className="input-prefix">
                <span>$</span>
                <input
                  type="number" step="1" min="0"
                  aria-label="Most at risk at once"
                  aria-describedby="limit-help"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
              {/* The correction that matters most on this screen. */}
              <span id="limit-help" className="mt-2 block text-[10px] leading-[1.6] text-[#8b8590]">
                This is a limit, not a payment. Nothing is sent now, and you are not funding the account with this number.
              </span>
              {!validLimit && (
                <span className="mt-2 block text-[10px] font-semibold text-[#dc6e58]">Enter a limit above $0 so the account has something to enforce.</span>
              )}
            </label>

            {created ? (
              <div className="mt-8 rounded-sm border border-[#cfe8db] bg-[#f7fcf9] p-5">
                <p className="text-[12px] font-bold text-[#40906b]">Your account is live.</p>
                <p className="mt-2 text-[11px] leading-[1.7] text-[#5f5a66]">
                  It will never have more than {money(value)} riding on open trades. It holds no funds yet — the next screen walks you through putting test USDC in.
                </p>
                <p className="mt-2.5 font-mono text-[9px] text-[#8d8792]">{created.vault}</p>
                <TxState tx={tx} labels={{ success: "Confirmed on Somnia Shannon." }} />
              </div>
            ) : (
              <div className="mt-8">
                {/* A wallet that cannot pay the fee is told here, not by a
                    wallet popup it cannot interpret. */}
                {noGas && (
                  <div className="mb-4 rounded-sm border border-[#f0dcc6] bg-[#fdf8f1] p-4">
                    <div className="text-[11px] font-bold text-[#8a6a34]">Your wallet needs test STT first</div>
                    <p className="mt-1.5 text-[10px] leading-[1.65] text-[#7d6b52]">
                      {readiness.gas.message} Test STT is free from the Somnia faucet, and this only needs to be done once.
                    </p>
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-bold text-[#6f58c2]">Get test STT ↗</a>
                  </div>
                )}

                {cannotPrepare && (
                  <div className="mb-4 rounded-sm border border-[#f0dcc6] bg-[#fdf8f1] p-4">
                    <div className="text-[11px] font-bold text-[#8a6a34]">This cannot be prepared right now</div>
                    <p className="mt-1.5 text-[10px] leading-[1.65] text-[#7d6b52]">
                      {readiness.gas.message} This is usually the network being briefly unreachable — wait a moment and reload.
                    </p>
                  </div>
                )}

                <button disabled={!ready} onClick={create} className="soft-button bg-[#111014] px-6 py-3 text-white disabled:opacity-35">
                  {tx.busy ? "Creating your account…" : "Create my account"}
                </button>

                {/* The balance read takes a moment. Saying so beats an enabled
                    button that silently has not been checked yet. */}
                {readiness === null && wallet.connected && !tx.busy && (
                  <p className="mt-3 flex items-center gap-2 text-[10px] font-semibold text-[#a19ca5]">
                    <span className="tx-spinner" aria-hidden="true" />
                    Checking your wallet has enough test STT for the fee…
                  </p>
                )}

                {!wallet.connected && (
                  <p className="mt-3 text-[10px] font-semibold text-[#a8a2ad]">Connect a wallet to continue.</p>
                )}
                {wallet.connected && !wallet.onShannon && (
                  <p className="mt-3 text-[10px] font-semibold text-[#a8a2ad]">
                    Your wallet is on another network. Switch it to Somnia Shannon to continue.
                  </p>
                )}

                <TxState
                  tx={tx}
                  labels={{
                    checking: "Checking your fee balance and preparing the transaction…",
                    signing: "Waiting for you to approve this in your wallet. Nothing has been sent yet.",
                  }}
                />

                <p className="mt-3 text-[10px] leading-[1.55] text-[#a19ca5]">
                  One transaction. It creates the account and nothing else.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Point({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-[#8b72e8] text-[9px] font-bold text-[#7056c9]">{n}</span>
      <div>
        <div className="text-[12px] font-bold text-[#28252c]">{title}</div>
        <p className="mt-1.5 text-[11px] leading-[1.7] text-[#7f7984]">{children}</p>
      </div>
    </li>
  );
}
