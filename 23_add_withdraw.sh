#!/usr/bin/env bash
set -euo pipefail
python3 - << 'PY'
p="src/SequenceHandler.sol"; s=open(p).read()
hook='''
    // ---- owner rescue: pull SOM / tUSDC back out (funds must never strand) ----
    function withdrawNative(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = payable(owner).call{value: amount}("");
        require(ok, "native withdraw failed");
    }
    function withdrawToken(address token, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        IERC20(token).approve(address(this), 0); // noop guard; approve not transfer
        // use low-level transfer via IERC20 minimal - add transfer to interface
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", owner, amount));
        require(ok && (ret.length == 0 || abi.decode(ret,(bool))), "token withdraw failed");
    }
'''
idx=s.rstrip().rfind('}')
s=s[:idx]+hook+'\n}\n'
open(p,'w').write(s)
print("added withdrawNative + withdrawToken")
PY
forge build
