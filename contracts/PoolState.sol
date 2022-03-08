// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IComptroller} from "./interfaces/IComptroller.sol";
import {IDSProxy, IDSProxyRegistry} from "./interfaces/IDSProxy.sol";
import {IShareToken} from "./interfaces/IShareToken.sol";
import {IMortgageVault} from "./interfaces/IMortgageVault.sol";
import {ISetupAction} from "./interfaces/ISetupAction.sol";

abstract contract PoolState {
    enum State {
        Initializing,
        Reviewing,
        Executing,
        RedemptionPending,
        Liquidating,
        Closed
    }

    uint256 public level;
    State public state;
    IComptroller public comptroller;
    IMortgageVault public mortgageVault;
    IERC20 public denomination;
    IShareToken public shareToken;
    IDSProxy public vault; // DSProxy
    uint256 public reserveExecution;
    uint256 public pendingStartTime;

    event StateTransited(State to);

    error InvalidState(State current);

    modifier whenState(State expect) {
        if (state != expect) revert InvalidState(state);
        _;
    }

    modifier whenStates(State expect1, State expect2) {
        if (state != expect1 && state != expect2) revert InvalidState(state);
        _;
    }

    modifier when3States(
        State expect1,
        State expect2,
        State expect3
    ) {
        if (state != expect1 && state != expect2 && state != expect3)
            revert InvalidState(state);
        _;
    }

    modifier whenNotState(State expectNot) {
        if (state == expectNot) revert InvalidState(state);
        _;
    }

    // State Changes

    function _review() internal whenState(State.Initializing) {
        _enterState(State.Reviewing);
    }

    function _finalize() internal whenState(State.Reviewing) {
        _enterState(State.Executing);
    }

    function _pend() internal whenState(State.Executing) {
        _enterState(State.RedemptionPending);
        pendingStartTime = block.timestamp;
    }

    function _resume() internal whenState(State.RedemptionPending) {
        pendingStartTime = 0;
        _enterState(State.Executing);
    }

    function _liquidate() internal whenState(State.RedemptionPending) {
        pendingStartTime = 0;
        _enterState(State.Liquidating);
    }

    function _close() internal whenStates(State.Executing, State.Liquidating) {
        _enterState(State.Closed);
    }

    function _enterState(State state_) internal {
        state = state_;
        emit StateTransited(state_);
    }

    // Setters

    function _setLevel(uint256 level_) internal {
        require(level == 0, "Level is set");
        require(level_ > 0, "level should not be 0");
        level = level_;
    }

    function _setComptroller(IComptroller comptroller_) internal {
        require(
            address(comptroller) == address(0),
            "Comptroller is initialized"
        );
        require(
            address(comptroller_) != address(0),
            "Comptroller should not be zero address"
        );
        comptroller = comptroller_;
    }

    function _setDenomination(IERC20 denomination_) internal {
        require(
            comptroller.isValidDenomination(address(denomination_)),
            "Invalid denomination"
        );
        denomination = denomination_;
    }

    function _setShareToken(IShareToken shareToken_) internal {
        require(
            address(shareToken) == address(0),
            "Share token is initialized"
        );
        require(
            address(shareToken_) != address(0),
            "Share token should not be zero address"
        );
        shareToken = shareToken_;
    }

    function _setMortgageVault(IComptroller comptroller_) internal {
        require(
            address(mortgageVault) == address(0),
            "MortgageVault is initialized"
        );
        require(
            address(comptroller_) != address(0),
            "Comptroller should not be zero address"
        );
        mortgageVault = comptroller_.mortgageVault();
        require(
            address(mortgageVault) != address(0),
            "MortgageVault is not initialized"
        );
    }

    function _setVault(IDSProxyRegistry dsProxyRegistry) internal {
        require(address(vault) == address(0), "Vault is initialized");
        require(
            address(dsProxyRegistry) != address(0),
            "Registry should not be zero address"
        );

        // deploy vault
        vault = IDSProxy(dsProxyRegistry.build());
        require(address(vault) != address(0), "Vault is not initialized");
    }

    function _setVaultApproval(ISetupAction setupAction) internal {
        require(
            address(vault) != address(0),
            "Vault should not be zero address"
        );
        require(
            address(setupAction) != address(0),
            "Setup should not be zero address"
        );
        require(
            comptroller.isValidDenomination(address(denomination)),
            "Invalid denomination"
        );

        // set vault approval
        bytes memory data = abi.encodeWithSignature(
            "maxApprove(address)",
            denomination
        );
        vault.execute(address(setupAction), data);

        require(
            denomination.allowance(address(vault), address(this)) ==
                type(uint256).max,
            "wrong allowance"
        );
    }

    function _setReserveExecution(uint256 reserveExecution_) internal {
        reserveExecution = reserveExecution_;
    }
}
