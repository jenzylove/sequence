import { useCallback, useEffect, useRef, useState } from "react";

const SHANNON_CHAIN_ID = "0xc488";

export function useWallet() {
  const [wallets, setWallets] = useState([]);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const activeProvider = useRef(null);

  useEffect(() => {
    const providers = new Map();
    const publish = () => setWallets([...providers.values()]);
    const announce = (event) => {
      const detail = event.detail;
      if (!detail?.provider || !detail?.info?.uuid) return;
      providers.set(detail.info.uuid, detail);
      publish();
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const legacyTimer = window.setTimeout(() => {
      if (providers.size === 0 && window.ethereum) {
        providers.set("legacy-injected", {
          info: { uuid: "legacy-injected", name: "Browser wallet", icon: "", rdns: "injected" },
          provider: window.ethereum,
        });
        publish();
      }
    }, 250);
    return () => {
      window.clearTimeout(legacyTimer);
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);

  const disconnect = useCallback(() => {
    activeProvider.current = null;
    setAccount(null);
    setChainId(null);
    setWalletName(null);
    setError(null);
    setStatus("idle");
  }, []);

  const connect = useCallback(async (wallet) => {
    setStatus("connecting");
    setError(null);
    try {
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
      if (!accounts?.[0]) throw new Error("The wallet did not return an account.");
      const nextChainId = await wallet.provider.request({ method: "eth_chainId" });
      activeProvider.current = wallet.provider;
      setAccount(accounts[0]);
      setChainId(nextChainId);
      setWalletName(wallet.info.name);
      setStatus("connected");

      wallet.provider.on?.("accountsChanged", (nextAccounts) => {
        if (!nextAccounts?.[0]) disconnect();
        else setAccount(nextAccounts[0]);
      });
      wallet.provider.on?.("chainChanged", setChainId);
      wallet.provider.on?.("disconnect", disconnect);
      return true;
    } catch (cause) {
      setError(cause?.code === 4001 ? "Connection was cancelled." : (cause?.message || "Could not connect this wallet."));
      setStatus("error");
      return false;
    }
  }, [disconnect]);

  return {
    wallets,
    account,
    chainId,
    walletName,
    status,
    error,
    connected: Boolean(account),
    onShannon: chainId?.toLowerCase() === SHANNON_CHAIN_ID,
    connect,
    disconnect,
  };
}

export function shortAccount(account) {
  return account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "";
}
