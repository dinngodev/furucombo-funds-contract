// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {ERC20, ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IShareToken} from "./interfaces/IShareToken.sol";
import {Errors} from "./utils/Errors.sol";

contract ShareToken is ERC20Permit, Ownable, IShareToken {
    address private constant _OUTSTANDING_PERFORMANCE_FEE_ACCOUNT = address(1);
    uint8 private immutable _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20Permit(name_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function netTotalShare() external view returns (uint256) {
        return totalSupply() - balanceOf(_OUTSTANDING_PERFORMANCE_FEE_ACCOUNT);
    }

    function grossTotalShare() external view returns (uint256) {
        return totalSupply();
    }

    function mint(address account_, uint256 amount_) external onlyOwner {
        _mint(account_, amount_);
    }

    function burn(address account_, uint256 amount_) external onlyOwner {
        _burn(account_, amount_);
    }

    function move(
        address sender_,
        address recipient_,
        uint256 amount_
    ) external onlyOwner {
        _transfer(sender_, recipient_, amount_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function _beforeTokenTransfer(
        address from_,
        address to_,
        uint256 amount_
    ) internal virtual override {
        Errors._require(from_ != address(this), Errors.Code.SHARE_TOKEN_INVALID_FROM);
        if (to_ == _OUTSTANDING_PERFORMANCE_FEE_ACCOUNT) {
            Errors._require(from_ == address(0), Errors.Code.SHARE_TOKEN_INVALID_TO);
        }
        super._beforeTokenTransfer(from_, to_, amount_);
    }
}
