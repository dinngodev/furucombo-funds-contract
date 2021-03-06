// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDSProxyRegistry} from "../interfaces/IDSProxy.sol";
import {ShareModule} from "../modules/ShareModule.sol";
import {BaseMock} from "./BaseMock.sol";

contract ShareModuleMock is ShareModule, BaseMock {
    uint256 public reserveMock;
    uint256 public grossAssetValueMock;
    uint256 public pendingPenaltyMock;
    bool public grossAssetValueMocked;

    event BeforePurchaseCalled();
    event AfterPurchaseCalled();
    event BeforeRedeemCalled();
    event AfterRedeemCalled();

    constructor(IDSProxyRegistry dsProxyRegistry_) BaseMock(dsProxyRegistry_) {}

    function setReserve(uint256 amount_) external {
        reserveMock = amount_;
    }

    function setGrossAssetValue(uint256 amount_) external {
        grossAssetValueMock = amount_;
        grossAssetValueMocked = true;
    }

    function settlePendingShare() external {
        _settlePendingShare(true);
    }

    function setPendingPenalty(uint256 penalty_) external {
        pendingPenaltyMock = penalty_;
    }

    function settlePendingShareWithoutPenalty() external {
        _settlePendingShare(false);
    }

    function setPendingUserPendingInfo(
        address user,
        uint256 round,
        uint256 share
    ) external {
        pendingUsers[user].pendingRound = round;
        pendingUsers[user].pendingShare = share;
    }

    function _beforePurchase() internal override returns (uint256) {
        emit BeforePurchaseCalled();
        return grossAssetValueMock;
    }

    function _afterPurchase(uint256) internal override {
        emit AfterPurchaseCalled();
    }

    function _beforeRedeem() internal override returns (uint256) {
        emit BeforeRedeemCalled();
        return grossAssetValueMock;
    }

    function _afterRedeem(uint256) internal override {
        emit AfterRedeemCalled();
    }

    function _getPendingPenalty() internal view override returns (uint256) {
        return pendingPenaltyMock;
    }

    function getReserve() public view override returns (uint256) {
        return reserveMock;
    }

    function __getGrossAssetValue() internal view override returns (uint256) {
        return grossAssetValueMock;
    }
}
