// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Usdt} from "../interfaces/IERC20Usdt.sol";
import {AssetQuotaAction} from "../utils/AssetQuotaAction.sol";
import {DealingAssetAction} from "../utils/DealingAssetAction.sol";

abstract contract ActionBase is AssetQuotaAction, DealingAssetAction {
    using SafeERC20 for IERC20;

    // prettier-ignore
    address public constant NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function _getBalance(address token_) internal view returns (uint256) {
        return _getBalanceWithAmount(token_, type(uint256).max);
    }

    function _getBalanceWithAmount(address token_, uint256 amount_) internal view returns (uint256) {
        if (amount_ != type(uint256).max) {
            return amount_;
        }

        // Native token
        if (token_ == NATIVE_TOKEN_ADDRESS) {
            return address(this).balance;
        }
        // ERC20 token
        return IERC20(token_).balanceOf(address(this));
    }

    function _tokenApprove(
        address token_,
        address spender_,
        uint256 amount_
    ) internal {
        try IERC20Usdt(token_).approve(spender_, amount_) {} catch {
            IERC20(token_).safeApprove(spender_, 0);
            IERC20(token_).safeApprove(spender_, amount_);
        }
    }
}
