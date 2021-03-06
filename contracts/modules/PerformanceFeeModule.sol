// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ABDKMath64x64} from "abdk-libraries-solidity/ABDKMath64x64.sol";
import {FundProxyStorageUtils} from "../FundProxyStorageUtils.sol";
import {LibFee} from "../libraries/LibFee.sol";
import {Errors} from "../utils/Errors.sol";

/// @title Performance fee module
abstract contract PerformanceFeeModule is FundProxyStorageUtils {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;

    int128 private constant _FEE_BASE64x64 = 1 << 64;
    uint256 private constant _FEE_PERIOD = 31557600; // 365.25*24*60*60
    address private constant _OUTSTANDING_ACCOUNT = address(1);

    event PerformanceFeeClaimed(address indexed manager, uint256 shareAmount);

    /// @notice Return the next crystallization time even if more than one period has passed.
    /// @return The available time for crystallization.
    function getNextCrystallizationTime() external view returns (uint256) {
        uint256 lastPeriod = _timeToPeriod(lastCrystallization);
        return _periodToTime(lastPeriod + 1);
    }

    /// @notice Check if the fund can be crystallized.
    /// @return The boolean of can crystallize or not.
    function isCrystallizable() public view virtual returns (bool) {
        uint256 nowPeriod = _timeToPeriod(block.timestamp);
        uint256 lastPeriod = _timeToPeriod(lastCrystallization);
        return nowPeriod > lastPeriod;
    }

    /// @notice Crystallize for the performance fee.
    /// @return Return the performance fee amount to be claimed.
    /// @dev This will check whether it can be crystallized or not.
    function crystallize() public virtual returns (uint256) {
        Errors._require(isCrystallizable(), Errors.Code.PERFORMANCE_FEE_MODULE_CAN_NOT_CRYSTALLIZED_YET);
        return _crystallize();
    }

    /// @notice Crystallize for the performance fee.
    /// @return Return the performance fee amount to be claimed.
    function _crystallize() internal virtual returns (uint256) {
        uint256 totalShare = shareToken.netTotalShare();
        if (totalShare == 0) return 0;
        uint256 grossAssetValue = __getGrossAssetValue();
        _updatePerformanceFee(grossAssetValue);
        address manager = owner();
        shareToken.move(_OUTSTANDING_ACCOUNT, manager, lastOutstandingShare);
        _updateGrossSharePrice(grossAssetValue);
        uint256 result = lastOutstandingShare;
        lastOutstandingShare = 0;
        pFeeSum = 0;
        lastCrystallization = block.timestamp;
        hwm64x64 = LibFee._max64x64(hwm64x64, lastGrossSharePrice64x64);
        emit PerformanceFeeClaimed(manager, result);

        return result;
    }

    /// @notice Convert the time to the number of crystallization periods.
    /// @param timestamp_ The timestamp to be converted.
    /// @return The period of crystallization.
    function _timeToPeriod(uint256 timestamp_) internal view returns (uint256) {
        Errors._require(timestamp_ >= crystallizationStart, Errors.Code.PERFORMANCE_FEE_MODULE_TIME_BEFORE_START);
        return (timestamp_ - crystallizationStart) / crystallizationPeriod;
    }

    /// @notice Convert the number of crystallization periods to time.
    /// @param period_ The period to be converted.
    /// @return The starting time of the period.
    function _periodToTime(uint256 period_) internal view returns (uint256) {
        return crystallizationStart + period_ * crystallizationPeriod;
    }

    /// @notice Get the gross asset value.
    /// @return The value of gross asset.
    function __getGrossAssetValue() internal view virtual returns (uint256);

    /// @notice Initialize the performance fee, crystallization time and high water mark.
    function _initializePerformanceFee() internal virtual {
        lastGrossSharePrice64x64 = _FEE_BASE64x64;
        hwm64x64 = _FEE_BASE64x64;
        crystallizationStart = block.timestamp;
        lastCrystallization = block.timestamp;
    }

    /// @notice Set the performance fee rate.
    /// @param feeRate_ The fee rate on a 1e4 basis.
    /// @return The performance fee rate.
    function _setPerformanceFeeRate(uint256 feeRate_) internal virtual returns (int128) {
        Errors._require(
            feeRate_ < _FUND_PERCENTAGE_BASE,
            Errors.Code.PERFORMANCE_FEE_MODULE_FEE_RATE_SHOULD_BE_LESS_THAN_BASE
        );
        pFeeRate64x64 = feeRate_.divu(_FUND_PERCENTAGE_BASE);
        return pFeeRate64x64;
    }

    /// @notice Set the crystallization period.
    /// @param period_ The crystallization period to be set in second.
    function _setCrystallizationPeriod(uint256 period_) internal virtual {
        Errors._require(period_ > 0, Errors.Code.PERFORMANCE_FEE_MODULE_CRYSTALLIZATION_PERIOD_TOO_SHORT);
        crystallizationPeriod = period_;
    }

    /// @notice Update the performance fee based on the performance since last
    ///         update. The fee will be minted as outstanding shares.
    /// @param grossAssetValue_ The gross asset value.
    function _updatePerformanceFee(uint256 grossAssetValue_) internal virtual {
        // Get accumulated wealth
        uint256 totalShare = shareToken.netTotalShare();
        if (totalShare == 0) {
            // net asset value should be 0 also
            return;
        }
        int128 grossSharePrice64x64 = grossAssetValue_.divu(totalShare);
        int256 wealth = LibFee
            ._max64x64(hwm64x64, grossSharePrice64x64)
            .sub(LibFee._max64x64(hwm64x64, lastGrossSharePrice64x64))
            .muli(totalShare.toInt256());
        int256 fee = pFeeRate64x64.muli(wealth);
        pFeeSum = LibFee._max(0, pFeeSum.toInt256() + fee).toUint256();
        uint256 netAssetValue = grossAssetValue_ - pFeeSum;
        uint256 outstandingShare = (totalShare * pFeeSum) / netAssetValue;
        if (outstandingShare > lastOutstandingShare) {
            shareToken.mint(_OUTSTANDING_ACCOUNT, outstandingShare - lastOutstandingShare);
        } else {
            shareToken.burn(_OUTSTANDING_ACCOUNT, lastOutstandingShare - outstandingShare);
        }
        lastOutstandingShare = outstandingShare;
        lastGrossSharePrice64x64 = grossSharePrice64x64;
    }

    /// @notice Update gross share price.
    /// @param grossAssetValue_ The gross asset value.
    function _updateGrossSharePrice(uint256 grossAssetValue_) internal virtual {
        uint256 totalShare = shareToken.netTotalShare();
        lastGrossSharePrice64x64 = grossAssetValue_.divu(totalShare);
    }
}
