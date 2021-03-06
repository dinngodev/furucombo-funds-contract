// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SimpleToken
 * @dev Very simple ERC20 Token example, where all tokens are pre-assigned to the creator.
 * Note they can later distribute these tokens as they wish using `transfer` and other
 * `StandardToken` functions.
 */
contract SimpleToken is ERC20("SimpleToken", "SIM") {
    uint256 public constant INITIAL_SUPPLY = 10000 * (10**uint256(18));

    /**
     * @dev Constructor that gives msg.sender all of existing tokens.
     */
    constructor() {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    function mint(address account_, uint256 amount_) external {
        _mint(account_, amount_);
    }

    function burn(address account_, uint256 amount_) external {
        _burn(account_, amount_);
    }

    function move(
        address sender_,
        address recipient_,
        uint256 amount_
    ) external {
        _transfer(sender_, recipient_, amount_);
    }

    function grossTotalShare() external view returns (uint256) {
        return totalSupply();
    }

    function netTotalShare() external view returns (uint256) {
        return totalSupply() - balanceOf(address(1));
    }
}
