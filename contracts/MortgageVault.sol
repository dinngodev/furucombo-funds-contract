// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "./utils/Errors.sol";

contract MortgageVault {
    using SafeERC20 for IERC20;

    IERC20 public mortgageToken;
    uint256 public totalAmount;
    mapping(address => uint256) public fundAmounts;

    event Mortgaged(address indexed sender, address indexed fund, uint256 amount);
    event Claimed(address indexed receiver, address indexed fund, uint256 amount);

    constructor(IERC20 token_) {
        mortgageToken = token_;
    }

    function mortgage(
        address sender_,
        address fund_,
        uint256 amount_
    ) external {
        Errors._require(fundAmounts[fund_] == 0, Errors.Code.MORTGAGE_VAULT_FUND_MORTGAGED);
        fundAmounts[fund_] += amount_;
        totalAmount += amount_;
        mortgageToken.safeTransferFrom(sender_, address(this), amount_);
        emit Mortgaged(sender_, fund_, amount_);
    }

    function claim(address receiver_) external {
        address fund = msg.sender;
        uint256 amount = fundAmounts[fund];
        fundAmounts[fund] = 0;
        totalAmount -= amount;

        mortgageToken.safeTransfer(receiver_, amount);
        emit Claimed(receiver_, fund, amount);
    }
}
