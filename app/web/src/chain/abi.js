// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-abi.mjs from out/SequenceVault.sol/SequenceVault.json,
// so this ABI is exactly the compiled src/SequenceVault.sol interface.
export const vaultAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "module_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "collateral_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxOutstanding_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "approvePool",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "armStep",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "s",
        "type": "tuple",
        "internalType": "struct SequenceVault.Step",
        "components": [
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum SequenceVault.Status"
          },
          {
            "name": "triggerMarketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "pool",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expireNs",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "orderType",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "actionOnWin0",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "actionOnWin1",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "notionalCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "successorMarketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nextStepId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "orderId",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "winningOutcome",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelStep",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelSubscription",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "collateral",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "consumed",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxOutstandingNotional",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "module",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinaryMarketsModule"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onEvent",
    "inputs": [
      {
        "name": "emitter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "eventTopics",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "outstandingByMarket",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "outstandingNotional",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "queueStep",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "s",
        "type": "tuple",
        "internalType": "struct SequenceVault.Step",
        "components": [
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum SequenceVault.Status"
          },
          {
            "name": "triggerMarketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "pool",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "price",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quantity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expireNs",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "orderType",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "actionOnWin0",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "actionOnWin1",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "notionalCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "successorMarketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "nextStepId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "orderId",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "winningOutcome",
            "type": "uint8",
            "internalType": "uint8"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "releaseExposure",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMaxOutstanding",
    "inputs": [
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "p",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "stepForMarket",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "stepStatus",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum SequenceVault.Status"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "steps",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum SequenceVault.Status"
      },
      {
        "name": "triggerMarketId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "quantity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expireNs",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "orderType",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "actionOnWin0",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "actionOnWin1",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "notionalCap",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "successorMarketId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nextStepId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "orderId",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "winningOutcome",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "subscribeAllMarkets",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "subscribeAllMarketsWith",
    "inputs": [
      {
        "name": "priorityFeePerGas",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "maxFeePerGas",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "gasLimit",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "subscriptionId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "syncResolution",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawNative",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "ChainAdvanced",
    "inputs": [
      {
        "name": "fromStepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "toStepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExposureReleased",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PausedSet",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Placed",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "orderId",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "notional",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PlacementRejected",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Recovered",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ResolutionSynced",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "questionId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Skipped",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "reason",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StepArmed",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "triggerMarketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pool",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StepCancelled",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StepQueued",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "triggerMarketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "StepWaiting",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "subscriptionId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Subscribed",
    "inputs": [
      {
        "name": "subscriptionId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Triggered",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "questionId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "voided",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "winningOutcome",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadySubscribed",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadAction",
    "inputs": [
      {
        "name": "action",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadState",
    "inputs": [
      {
        "name": "have",
        "type": "uint8",
        "internalType": "enum SequenceVault.Status"
      },
      {
        "name": "need",
        "type": "uint8",
        "internalType": "enum SequenceVault.Status"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadTopics",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CapExceeded",
    "inputs": [
      {
        "name": "requested",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyFilter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GasLimitExceeded",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GasLimitZero",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HandlerZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InsufficientBalance",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMaxFeePerGas",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoExposure",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoSubscription",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotQueued",
    "inputs": [
      {
        "name": "stepId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotResolvedYet",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "OnlyReactivityPrecompile",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Paused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StepExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StepNotArmed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnexpectedEmitter",
    "inputs": [
      {
        "name": "got",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownMarket",
    "inputs": [
      {
        "name": "marketId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnsubscribeFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VaultCapExceeded",
    "inputs": [
      {
        "name": "outstanding",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "cap",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongTopic0",
    "inputs": []
  }
];
