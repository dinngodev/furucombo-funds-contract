// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ABDKMath64x64} from "abdk-libraries-solidity/ABDKMath64x64.sol";
import {LibFee} from "../libs/LibFee.sol";
import {IShareERC20} from "../interfaces/IShareERC20.sol";

abstract contract PerformanceFee {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for int256;
    using ABDKMath64x64 for uint256;

    int128 private _feeRate64x64;
    uint256 private constant FEE_BASE = 10000;
    uint256 private constant FEE_PERIOD = 365 days;
    uint256 private constant FEE_DENOMINATOR = FEE_BASE * FEE_PERIOD;
    int128 private _hwm64x64; // should be a float point number
    int128 private _lastGrossSharePrice64x64;
    uint256 private _feeSum;
    uint256 private _lastOutstandingShare;

    function updatePerformanceShare() public {
        IShareERC20 shareToken = __getShareToken();
        // Get accumulated wealth
        uint256 grossAssetValue = __getNetAssetValue();
        uint256 totalShare = shareToken.totalSupply();
        int128 grossSharePrice64x64 = grossAssetValue.divu(totalShare);
        int256 wealth = LibFee
            ._max64x64(_hwm64x64, grossSharePrice64x64)
            .sub(LibFee._max64x64(_hwm64x64, _lastGrossSharePrice64x64))
            .muli(int256(totalShare));
        int256 fee = _feeRate64x64.muli(wealth);
        _feeSum = uint256(LibFee._max(0, int256(_feeSum) + fee));
        uint256 netAssetValue = grossAssetValue - _feeSum;
        uint256 outstandingShare = (totalShare * _feeSum) / netAssetValue;
        if (outstandingShare > _lastOutstandingShare) {
            _mintOutstandingShare(outstandingShare - _lastOutstandingShare);
        } else {
            _burnOutstandingShare(_lastOutstandingShare - outstandingShare);
        }
        _lastOutstandingShare = outstandingShare;
    }

    function setPerformanceFeeRate(uint256 feeRate)
        public
        virtual
        returns (int128)
    {
        _feeRate64x64 = feeRate.fromUInt();

        return _feeRate64x64;
    }

    function _mintOutstandingShare(uint256 amount) internal {
        IShareERC20 shareToken = __getShareToken();
        shareToken.mint(address(0), amount);
    }

    function _burnOutstandingShare(uint256 amount) internal {
        IShareERC20 shareToken = __getShareToken();
        shareToken.burn(address(0), amount);
    }

    function __getShareToken() internal view virtual returns (IShareERC20);

    function __getNetAssetValue() internal view virtual returns (uint256);

    function __getGrossAssetValue() internal view virtual returns (uint256);
}
