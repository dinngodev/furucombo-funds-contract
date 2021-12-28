// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IBeacon} from "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";

interface IComptroller is IBeacon {
    function canDelegateCall(
        uint256 level,
        address _to,
        bytes4 sig
    ) external view returns (bool);

    function canContractCall(
        uint256 level,
        address to,
        bytes4 sig
    ) external view returns (bool);

    function canHandlerCalls(
        uint256 level,
        address to,
        bytes4 sig
    ) external view returns (bool);

    function execFeePercentage() external view returns (uint256);

    function execFeeCollector() external view returns (address);

    function validateDealingAsset(uint256 level, address asset)
        external
        view
        returns (bool);

    function validateDealingAssets(uint256 level, address[] calldata assets)
        external
        view
        returns (bool);

    function validateInitialAssets(uint256 level, address[] calldata assets)
        external
        view
        returns (bool);

    function assetRouter() external view returns (address);

    function execAction() external view returns (address);

    function setupAction() external view returns (address);
}
