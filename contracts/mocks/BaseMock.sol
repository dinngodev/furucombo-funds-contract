// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDSProxy, IDSProxyRegistry} from "../interfaces/IDSProxy.sol";
import {IComptroller} from "../interfaces/IComptroller.sol";
import {IShareToken} from "../interfaces/IShareToken.sol";
import {PoolState} from "../PoolState.sol";
import {ShareToken} from "../ShareToken.sol";
import {SetupAction} from "../actions/SetupAction.sol";

contract BaseMock is PoolState {
    IDSProxyRegistry public immutable dsProxyRegistry;

    constructor(IDSProxyRegistry dsProxyRegistry_) {
        dsProxyRegistry = dsProxyRegistry_;
    }

    function setLevel(uint256 level_) external {
        _setLevel(level_);
    }

    function setState(State state_) external {
        _enterState(state_);
    }

    function setComptroller(IComptroller comptroller_) external {
        _setComptroller(comptroller_);
    }

    function setDenomination(IERC20 denomination_) external {
        _setDenomination(denomination_);
    }

    function setShare() external returns (address) {
        ShareToken token = new ShareToken("TST", "Test share");
        _setShare(IShareToken(address(token)));
        return address(token);
    }

    function setDSProxy() external {
        address dsProxy_ = dsProxyRegistry.build();
        _setDSProxy(IDSProxy(dsProxy_));
        SetupAction action = new SetupAction();
        bytes memory data = abi.encodeWithSignature(
            "maxApprove(address)",
            denomination
        );
        vault.execute(address(action), data);
    }

    function setReserveExecution(uint256 reserve_) external {
        _setReserveExecution(reserve_);
    }
}
