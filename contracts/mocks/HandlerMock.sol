// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {HandlerBase} from "../furucombo/handlers/HandlerBase.sol";

contract HandlerMock is HandlerBase {
    using SafeERC20 for IERC20;

    // prettier-ignore
    address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function getContractName() public pure override returns (string memory) {
        return "HandlerMock";
    }

    function doUint(uint256 u_) external payable returns (uint256) {
        return u_;
    }

    function doAddress(address a_) external payable returns (address) {
        return a_;
    }
}
