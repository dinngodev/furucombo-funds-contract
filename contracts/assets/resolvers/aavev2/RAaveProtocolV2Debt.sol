// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IATokenV2} from "../../../interfaces/IATokenV2.sol";
import {IAssetResolver} from "../../interfaces/IAssetResolver.sol";
import {AssetResolverBase} from "../../AssetResolverBase.sol";
import {Errors} from "../../../utils/Errors.sol";

/// @title Aave protocol v2 debt resolver
contract RAaveProtocolV2Debt is IAssetResolver, AssetResolverBase {
    /// @notice Calculate asset value
    /// @param asset_ The asset address, and should be debtToken.
    /// @param amount_ The amount of assets.
    /// @param quote_ The address of the quote token for which the value is calculated.
    /// @return The amount of quote token equal to the value.
    /// @dev The value must be negative.
    function calcAssetValue(
        address asset_,
        uint256 amount_,
        address quote_
    ) external view returns (int256) {
        address underlying = IATokenV2(asset_).UNDERLYING_ASSET_ADDRESS();
        int256 value = -(_calcAssetValue(underlying, amount_, quote_));
        Errors._require(value <= 0, Errors.Code.RESOLVER_ASSET_VALUE_POSITIVE);
        return value;
    }
}
