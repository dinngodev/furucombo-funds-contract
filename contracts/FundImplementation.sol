// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {AssetModule} from "./modules/AssetModule.sol";
import {ExecutionModule} from "./modules/ExecutionModule.sol";
import {ManagementFeeModule} from "./modules/ManagementFeeModule.sol";
import {PerformanceFeeModule} from "./modules/PerformanceFeeModule.sol";
import {ShareModule} from "./modules/ShareModule.sol";
import {IAssetRouter} from "./assets/interfaces/IAssetRouter.sol";
import {IComptroller} from "./interfaces/IComptroller.sol";
import {IShareToken} from "./interfaces/IShareToken.sol";
import {Errors} from "./utils/Errors.sol";

/// @title The implementation contract for fund
/// @notice The functions that requires ownership, interaction between
///         different modules should be overridden and implemented here.
contract FundImplementation is AssetModule, ShareModule, ExecutionModule, ManagementFeeModule, PerformanceFeeModule {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    constructor() {
        // set owner to address(0) in implementation contract
        renounceOwnership();
    }

    /////////////////////////////////////////////////////
    // State Changes
    /////////////////////////////////////////////////////
    /// @notice Initializer, only in `Initializing` state.
    /// @param level_ The tier of the fund.
    /// @param comptroller_ The comptroller address.
    /// @param denomination_ The denomination asset.
    /// @param shareToken_ The share token address.
    /// @param mFeeRate_ The management fee rate.
    /// @param pFeeRate_ The performance fee rate.
    /// @param crystallizationPeriod_ The crystallization period.
    /// @param newOwner_ The owner to be assigned to the fund.
    function initialize(
        uint256 level_,
        IComptroller comptroller_,
        IERC20 denomination_,
        IShareToken shareToken_,
        uint256 mFeeRate_,
        uint256 pFeeRate_,
        uint256 crystallizationPeriod_,
        address newOwner_
    ) external whenState(State.Initializing) {
        _setLevel(level_);
        _setComptroller(comptroller_);
        _setDenomination(denomination_);
        _setShareToken(shareToken_);
        _setManagementFeeRate(mFeeRate_);
        _setPerformanceFeeRate(pFeeRate_);
        _setCrystallizationPeriod(crystallizationPeriod_);
        _setVault(comptroller_.dsProxyRegistry());
        _setMortgageVault(comptroller_);
        _transferOwnership(newOwner_);
        _review();
    }

    /// @notice Finalize the initialization of the fund.
    function finalize() external nonReentrant onlyOwner {
        _finalize();

        // Add denomination to list and never remove
        Errors._require(getAssetList().length == 0, Errors.Code.IMPLEMENTATION_ASSET_LIST_NOT_EMPTY);

        Errors._require(
            comptroller.isValidDenomination(address(denomination)),
            Errors.Code.IMPLEMENTATION_INVALID_DENOMINATION
        );
        _addAsset(address(denomination));

        // Set approval for investor to redeem
        _setVaultApproval(comptroller.setupAction());

        // Initialize management fee parameters
        _initializeManagementFee();

        // Initialize performance fee parameters
        _initializePerformanceFee();

        // Transfer mortgage token to this fund then call mortgage vault
        (bool isMortgageTierSet, uint256 amount) = comptroller.mortgageTier(level);
        Errors._require(isMortgageTierSet, Errors.Code.IMPLEMENTATION_INVALID_MORTGAGE_TIER);
        if (amount > 0) {
            IERC20 mortgageToken = mortgageVault.mortgageToken();
            mortgageToken.safeTransferFrom(msg.sender, address(this), amount);
            mortgageToken.safeApprove(address(mortgageVault), amount);
            mortgageVault.mortgage(amount);
        }
    }

    /// @notice Resume the fund by anyone if can settle pending share.
    /// @dev Resume only in `Pending` state.
    function resume() external nonReentrant whenState(State.Pending) {
        uint256 grossAssetValue = getGrossAssetValue();
        Errors._require(
            _isPendingResolvable(true, grossAssetValue),
            Errors.Code.IMPLEMENTATION_PENDING_SHARE_NOT_RESOLVABLE
        );
        _settlePendingShare(true);
        _resume();
    }

    /// @notice Liquidate the fund by anyone and transfer owner to liquidator.
    function liquidate() external nonReentrant {
        Errors._require(pendingStartTime != 0, Errors.Code.IMPLEMENTATION_PENDING_NOT_START);
        Errors._require(
            block.timestamp >= pendingStartTime + comptroller.pendingExpiration(),
            Errors.Code.IMPLEMENTATION_PENDING_NOT_EXPIRE
        );
        _crystallize();
        _liquidate();

        _transferOwnership(comptroller.pendingLiquidator());
    }

    /// @notice Close fund. The pending share will be settled without penalty.
    /// @dev This function can only be used in `Executing` and `Liquidating` states.
    /// @inheritdoc AssetModule
    function close() public override onlyOwner nonReentrant whenStates(State.Executing, State.Liquidating) {
        _settlePendingShare(false);
        if (state == State.Executing) {
            _crystallize();
        }
        super.close();

        mortgageVault.claim(msg.sender);
    }

    /////////////////////////////////////////////////////
    // Setters
    /////////////////////////////////////////////////////
    /// @notice Set management fee rate only in `Reviewing` state.
    /// @param mFeeRate_ The management fee rate on a 1e4 basis.
    function setManagementFeeRate(uint256 mFeeRate_) external onlyOwner whenState(State.Reviewing) {
        _setManagementFeeRate(mFeeRate_);
    }

    /// @notice Set performance fee rate only in `Reviewing` state.
    /// @param pFeeRate_ The performance fee rate on a 1e4 basis.
    function setPerformanceFeeRate(uint256 pFeeRate_) external onlyOwner whenState(State.Reviewing) {
        _setPerformanceFeeRate(pFeeRate_);
    }

    /// @notice Set crystallization period only in `Reviewing` state.
    /// @param crystallizationPeriod_ The crystallization period to be set in second.
    function setCrystallizationPeriod(uint256 crystallizationPeriod_) external onlyOwner whenState(State.Reviewing) {
        _setCrystallizationPeriod(crystallizationPeriod_);
    }

    /////////////////////////////////////////////////////
    // Getters
    /////////////////////////////////////////////////////
    /// @notice Get gross asset value.
    /// @return Convert value to denomination amount.
    function getGrossAssetValue() public view virtual returns (uint256) {
        address[] memory assets = getAssetList();
        uint256 length = assets.length;
        uint256[] memory amounts = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            amounts[i] = IERC20(assets[i]).balanceOf(address(vault));
        }

        return _getAssetRouter().calcAssetsTotalValue(assets, amounts, address(denomination));
    }

    /// @notice Get the value of a give asset.
    /// @param asset_ The asset to be queried.
    function getAssetValue(address asset_) public view returns (int256) {
        uint256 balance = IERC20(asset_).balanceOf(address(vault));
        if (balance == 0) return 0;

        return _getAssetRouter().calcAssetValue(asset_, balance, address(denomination));
    }

    function _getAssetRouter() internal view returns (IAssetRouter) {
        return comptroller.assetRouter();
    }

    /// inheritdoc ShareModule, PerformanceFeeModule.
    function __getGrossAssetValue() internal view override(ShareModule, PerformanceFeeModule) returns (uint256) {
        return getGrossAssetValue();
    }

    /// @notice Get the balance of the denomination asset.
    /// @return The balance of reserve.
    /// @inheritdoc ShareModule
    function getReserve() public view override returns (uint256) {
        return denomination.balanceOf(address(vault));
    }

    /////////////////////////////////////////////////////
    // Asset Module
    /////////////////////////////////////////////////////
    /// @notice Add the asset to the tracking list by owner.
    /// @param asset_ The asset to be added.
    function addAsset(address asset_) external nonReentrant onlyOwner {
        _addAsset(asset_);
        _checkAssetCapacity();
    }

    /// @notice Add the asset to the tracking list.
    /// @param asset_ The asset to be added.
    /// @inheritdoc AssetModule
    function _addAsset(address asset_) internal override {
        Errors._require(comptroller.isValidDealingAsset(level, asset_), Errors.Code.IMPLEMENTATION_INVALID_ASSET);

        address _denomination = address(denomination);
        if (asset_ == _denomination) {
            super._addAsset(asset_);
        } else {
            int256 value = getAssetValue(asset_);
            int256 dust = _getDenominationDust(_denomination);

            if (value >= dust || value < 0) {
                super._addAsset(asset_);
            }
        }
    }

    /// @notice Remove the asset from the tracking list by owner.
    /// @param asset_ The asset to be removed.
    function removeAsset(address asset_) external nonReentrant onlyOwner {
        _removeAsset(asset_);
    }

    /// @notice Remove the asset from the tracking list.
    /// @param asset_ The asset to be removed.
    /// @inheritdoc AssetModule
    function _removeAsset(address asset_) internal override {
        // Do not allow to remove denomination from list
        address _denomination = address(denomination);
        if (asset_ != _denomination) {
            int256 value = getAssetValue(asset_);
            int256 dust = _getDenominationDust(_denomination);

            if (value < dust && value >= 0) {
                super._removeAsset(asset_);
            }
        }
    }

    /// @notice Get the denomination dust.
    /// @param denomination_ The denomination address.
    /// @return The dust of denomination.
    function _getDenominationDust(address denomination_) internal view returns (int256) {
        return comptroller.getDenominationDust(denomination_).toInt256();
    }

    /////////////////////////////////////////////////////
    // Execution module
    /////////////////////////////////////////////////////
    /// @inheritdoc ExecutionModule
    function execute(bytes calldata data_) public override nonReentrant onlyOwner {
        super.execute(data_);
    }

    /// @notice Check if the gross asset value is more than gross asset value tolerance after execute.
    function _isAfterValueEnough(uint256 prevAssetValue_, uint256 grossAssetValue_) internal view returns (bool) {
        uint256 minGrossAssetValue = (prevAssetValue_ * comptroller.execAssetValueToleranceRate()) /
            _FUND_PERCENTAGE_BASE;

        return grossAssetValue_ >= minGrossAssetValue;
    }

    /// @notice Execute an action on the fund's behalf.
    /// @return The gross asset value.
    /// @inheritdoc ExecutionModule
    function _beforeExecute() internal virtual override returns (uint256) {
        return getGrossAssetValue();
    }

    /// @notice Check the reserve after the execution.
    /// @return The gross asset value.
    /// @inheritdoc ExecutionModule
    function _afterExecute(bytes memory response_, uint256 prevGrossAssetValue_) internal override returns (uint256) {
        // Remove asset from assetList
        address[] memory assetList = getAssetList();
        for (uint256 i = 0; i < assetList.length; ++i) {
            _removeAsset(assetList[i]);
        }

        // Add new asset to assetList
        address[] memory dealingAssets = abi.decode(response_, (address[]));
        for (uint256 i = 0; i < dealingAssets.length; ++i) {
            _addAsset(dealingAssets[i]);
        }

        _checkAssetCapacity();

        // Get new gross asset value
        uint256 grossAssetValue = getGrossAssetValue();
        Errors._require(
            _isAfterValueEnough(prevGrossAssetValue_, grossAssetValue),
            Errors.Code.IMPLEMENTATION_INSUFFICIENT_TOTAL_VALUE_FOR_EXECUTION
        );

        // Resume fund if the balance is sufficient to resolve pending state
        if (state == State.Pending && _isPendingResolvable(true, grossAssetValue)) {
            uint256 totalRedemption = _settlePendingShare(true);
            _resume();
            // minus redeemed denomination amount
            grossAssetValue -= totalRedemption;
        }

        return grossAssetValue;
    }

    /////////////////////////////////////////////////////
    // Management fee module
    /////////////////////////////////////////////////////
    /// @notice Manangement fee should only be accumulated in `Executing` state.
    /// @return The newly minted shares.
    /// @inheritdoc ManagementFeeModule
    function _updateManagementFee() internal override returns (uint256) {
        if (state == State.Executing) {
            return super._updateManagementFee();
        } else if (state == State.Pending) {
            lastMFeeClaimTime = block.timestamp;
        }
        return 0;
    }

    /////////////////////////////////////////////////////
    // Performance fee module
    /////////////////////////////////////////////////////
    /// @notice Crystallize for the performance fee.
    /// @dev This function can only be used in `Executing` and `Pending` states.
    /// @inheritdoc PerformanceFeeModule
    function crystallize()
        public
        override
        nonReentrant
        onlyOwner
        whenStates(State.Executing, State.Pending)
        returns (uint256)
    {
        return super.crystallize();
    }

    /// @notice Update the performace fee.
    /// @dev This function works only in `Executing` and `Pending` states.
    /// @inheritdoc PerformanceFeeModule
    function _updatePerformanceFee(uint256 grossAssetValue_) internal override {
        if (state == State.Executing || state == State.Pending) {
            super._updatePerformanceFee(grossAssetValue_);
        }
    }

    /// @notice Update the management fee before crystallization.
    /// @return The performance fee amount to be claimed.
    /// @inheritdoc PerformanceFeeModule
    function _crystallize() internal override returns (uint256) {
        _updateManagementFee();
        return super._crystallize();
    }

    /////////////////////////////////////////////////////
    // Share module
    /////////////////////////////////////////////////////
    /// @notice Update the management fee and performance fee before purchase
    ///         to get the lastest share price.
    /// @return The gross asset value.
    /// @inheritdoc ShareModule
    function _beforePurchase() internal override returns (uint256) {
        uint256 grossAssetValue = getGrossAssetValue();
        _updateManagementFee();
        _updatePerformanceFee(grossAssetValue);
        return grossAssetValue;
    }

    /// @notice Update the gross share price after purchase.
    /// @dev Attempt to settle in `Pending` state and resume to `Executing` state
    ///      if the fund is resolvable.
    /// @inheritdoc ShareModule
    function _afterPurchase(uint256 grossAssetValue_) internal override {
        _updateGrossSharePrice(grossAssetValue_);
        if (state == State.Pending && _isPendingResolvable(true, grossAssetValue_)) {
            grossAssetValue_ -= _settlePendingShare(true);
            _updateGrossSharePrice(grossAssetValue_);
            _resume();
        }
        return;
    }

    /// @notice Update the management fee and performance fee before redeem
    ///         to get the latest share price.
    /// @return The gross asset value.
    /// @inheritdoc ShareModule
    function _beforeRedeem() internal override returns (uint256) {
        uint256 grossAssetValue = getGrossAssetValue();
        _updateManagementFee();
        _updatePerformanceFee(grossAssetValue);
        return grossAssetValue;
    }

    /// @notice Update the gross share price after redeem.
    /// @inheritdoc ShareModule
    function _afterRedeem(uint256 grossAssetValue_) internal override {
        _updateGrossSharePrice(grossAssetValue_);
        return;
    }
}
