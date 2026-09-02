export const erc20Abi = [
  { type: "function", stateMutability: "view", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "decimals", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", stateMutability: "view", name: "symbol", inputs: [], outputs: [{ type: "string" }] },
];
