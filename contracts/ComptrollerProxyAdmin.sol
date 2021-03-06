// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @title The admin contract of comptroller proxy
/// @dev Admin can control comptroller upgrade.
contract ComptrollerProxyAdmin is Ownable {
    TransparentUpgradeableProxy public immutable proxy;

    constructor(TransparentUpgradeableProxy proxy_) {
        proxy = proxy_;
    }

    /// @notice Returns the current implementation of `proxy`.
    /// @dev This contract must be the admin of `proxy`.
    function getProxyImplementation() external view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("implementation()")) == 0x5c60da1b
        (bool success, bytes memory returndata) = address(proxy).staticcall(hex"5c60da1b");
        require(success);
        return abi.decode(returndata, (address));
    }

    /// @notice Returns the current admin of `proxy`.
    /// @dev This contract must be the admin of `proxy`.
    function getProxyAdmin() external view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("admin()")) == 0xf851a440
        (bool success, bytes memory returndata) = address(proxy).staticcall(hex"f851a440");
        require(success);
        return abi.decode(returndata, (address));
    }

    /// @notice Changes the admin of `proxy` to `newAdmin_`.
    /// @dev This contract must be the current admin of `proxy`.
    function changeProxyAdmin(address newAdmin_) external onlyOwner {
        proxy.changeAdmin(newAdmin_);
    }

    /// @notice Upgrades `proxy` to `implementation_`. See {TransparentUpgradeableProxy-upgradeTo}.
    /// @dev This contract must be the admin of `proxy`.
    function upgrade(address implementation_) external onlyOwner {
        proxy.upgradeTo(implementation_);
    }

    /// @notice Upgrades `proxy` to `implementation_` and calls a function on the new implementation
    ///         See {TransparentUpgradeableProxy-upgradeToAndCall}.
    /// @dev This contract must be the admin of `proxy`.
    function upgradeAndCall(address implementation_, bytes memory data_) external payable onlyOwner {
        proxy.upgradeToAndCall{value: msg.value}(implementation_, data_);
    }
}
