import { ethers, deployments, network } from 'hardhat';
import { Wallet, Signer, BigNumber, constants } from 'ethers';
import { expect } from 'chai';
import {
  Comptroller,
  ImplementationMock,
  IDSProxy,
  Chainlink,
  ERC20,
  AssetRouter,
  MortgageVault,
  SimpleToken,
  SimpleAction,
} from '../typechain';
import {
  DS_PROXY_REGISTRY,
  USDC_TOKEN,
  WETH_TOKEN,
  WBTC_TOKEN,
  BAT_TOKEN,
  CHAINLINK_USDC_USD,
  CHAINLINK_ETH_USD,
  CHAINLINK_WBTC_USD,
  FEE_BASE,
  FEE_BASE64x64,
  TOLERANCE_BASE,
  POOL_STATE,
} from './utils/constants';

import { simpleEncode, tokenProviderQuick, mwei } from './utils/utils';

describe('Implementation', function () {
  const denominationAddress = USDC_TOKEN;
  const denominationAggregator = CHAINLINK_USDC_USD;
  const denominationDust = mwei('0.1');
  const tokenAAddress = WETH_TOKEN;
  const tokenBAddress = WBTC_TOKEN;
  const tokenCAddress = BAT_TOKEN;
  const aggregatorA = CHAINLINK_ETH_USD;
  const aggregatorB = CHAINLINK_WBTC_USD;
  const tokenAAmount = ethers.utils.parseEther('1');
  const tokenBAmount = ethers.utils.parseUnits('1', 8);
  const execFeePercentage = 200; // 20%
  const managementFeeRate = 0; // 0%
  const performanceFeeRate = 1000; // 10%
  const valueTolerance = 9000; // 90%
  const pendingExpiration = 86400; // 1 day
  const CRYSTALLIZATION_PERIOD_MIN = 1; // 1 sec
  const crystallizationPeriod = CRYSTALLIZATION_PERIOD_MIN;
  const level = 1;
  const reserveExecution = 0;

  let comptroller: Comptroller;
  let action: SimpleAction;
  let implementation: ImplementationMock;
  let vault: IDSProxy;
  let oracle: Chainlink;

  let owner: Wallet;
  let user: Wallet;
  let liquidator: Wallet;

  let denomination: ERC20;
  let denominationProvider: Signer;
  let tokenA: ERC20;
  let tokenAProvider: Signer;
  let tokenB: ERC20;
  let tokenBProvider: Signer;
  let tokenC: ERC20;
  let tokenCProvider: Signer;
  let shareToken: SimpleToken;

  let assetRouter: AssetRouter;
  let mortgageVault: MortgageVault;

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }, options) => {
      await deployments.fixture();
      [owner, user, liquidator] = await (ethers as any).getSigners();

      denomination = await ethers.getContractAt('ERC20', denominationAddress);
      denominationProvider = await tokenProviderQuick(denomination.address);
      tokenA = await ethers.getContractAt('ERC20', tokenAAddress);
      tokenAProvider = await tokenProviderQuick(tokenA.address);
      tokenB = await ethers.getContractAt('ERC20', tokenBAddress);
      tokenBProvider = await tokenProviderQuick(tokenB.address);
      tokenC = await ethers.getContractAt('ERC20', tokenCAddress);
      tokenCProvider = await tokenProviderQuick(tokenC.address);

      implementation = await (
        await ethers.getContractFactory('ImplementationMock')
      ).deploy(DS_PROXY_REGISTRY);

      const canonicalResolver = await (
        await ethers.getContractFactory('RCanonical')
      ).deploy();

      const debtAssetResolver = await (
        await ethers.getContractFactory('AssetResolverMockB')
      ).deploy();

      const assetRegistry = await (
        await ethers.getContractFactory('AssetRegistry')
      ).deploy();
      await assetRegistry.register(
        denomination.address,
        canonicalResolver.address
      );
      await assetRegistry.register(tokenA.address, canonicalResolver.address);
      await assetRegistry.register(tokenB.address, canonicalResolver.address);
      await assetRegistry.register(tokenC.address, debtAssetResolver.address);

      oracle = await (await ethers.getContractFactory('Chainlink')).deploy();
      await oracle.addAssets(
        [denomination.address, tokenA.address, tokenB.address],
        [denominationAggregator, aggregatorA, aggregatorB]
      );

      assetRouter = await (
        await ethers.getContractFactory('AssetRouter')
      ).deploy(oracle.address, assetRegistry.address);

      mortgageVault = await (
        await ethers.getContractFactory('MortgageVault')
      ).deploy(tokenA.address);
      await mortgageVault.deployed();

      comptroller = await (
        await ethers.getContractFactory('Comptroller')
      ).deploy(
        implementation.address,
        assetRouter.address,
        owner.address,
        execFeePercentage,
        liquidator.address,
        pendingExpiration,
        mortgageVault.address,
        valueTolerance
      );
      action = await (await ethers.getContractFactory('SimpleAction')).deploy();
      await action.deployed();

      // Initialization
      await comptroller.permitDenominations(
        [denomination.address],
        [denominationDust]
      );
      await comptroller.permitAssets(level, [denomination.address]);
      await comptroller.setExecAction(action.address);

      shareToken = await (await ethers.getContractFactory('SimpleToken'))
        .connect(user)
        .deploy();
      await shareToken.deployed();

      await implementation
        .connect(owner)
        .initialize(
          level,
          comptroller.address,
          denomination.address,
          shareToken.address,
          managementFeeRate,
          performanceFeeRate,
          crystallizationPeriod,
          reserveExecution,
          owner.address
        );

      vault = await ethers.getContractAt(
        'IDSProxy',
        await implementation.vault()
      );
    }
  );

  beforeEach(async function () {
    await setupTest();
  });

  describe('State changes', function () {
    describe('Initialize', function () {
      it('should set level', async function () {
        const _level = await implementation.level();
        expect(_level).to.be.gt(0);
        expect(_level).to.be.eq(level);
      });
      it('should set comptroller', async function () {
        const comptrollerAddr = await implementation.comptroller();
        expect(comptrollerAddr).to.be.not.eq(constants.AddressZero);
        expect(comptrollerAddr).to.be.eq(comptroller.address);
      });
      it('should set denomination', async function () {
        const denominationAddr = await implementation.denomination();
        expect(denominationAddr).to.be.not.eq(constants.AddressZero);
        expect(denominationAddr).to.be.eq(denomination.address);
      });
      it('should set share token', async function () {
        const shareTokenAddr = await implementation.shareToken();
        expect(shareTokenAddr).to.be.not.eq(constants.AddressZero);
        expect(shareTokenAddr).to.be.eq(shareToken.address);
      });
      it('should set management fee rate', async function () {
        const feeRate = await implementation.getManagementFeeRate();
        expect(feeRate).to.be.eq(BigNumber.from(FEE_BASE64x64));
      });
      it('should set performance fee rate', async function () {
        const feeRate = await implementation.getPerformanceFeeRate();
        expect(feeRate).to.be.eq(BigNumber.from('1844674407370955161'));
      });
      it('should set crystallization period', async function () {
        const _crystallizationPeriod =
          await implementation.getCrystallizationPeriod();
        expect(_crystallizationPeriod).to.be.gte(CRYSTALLIZATION_PERIOD_MIN);
        expect(_crystallizationPeriod).to.be.eq(crystallizationPeriod);
      });
      it('should set vault', async function () {
        expect(await implementation.vault()).to.be.not.eq(
          constants.AddressZero
        );
      });
      it('should set owner', async function () {
        const _owner = await implementation.owner();
        expect(_owner).to.be.not.eq(constants.AddressZero);
        expect(_owner).to.be.eq(owner.address);
      });
      it('should set mortgage vault', async function () {
        const mortgageVault = await comptroller.mortgageVault();
        const _mortgageVault = await implementation.mortgageVault();
        expect(_mortgageVault).to.be.not.eq(constants.AddressZero);
        expect(_mortgageVault).to.be.eq(mortgageVault);
      });
      it('should revert: twice initialization', async function () {
        await expect(
          implementation
            .connect(owner)
            .initialize(
              0,
              constants.AddressZero,
              constants.AddressZero,
              constants.AddressZero,
              0,
              0,
              0,
              0,
              constants.AddressZero
            )
        ).to.be.revertedWith('InvalidState(1)');
      });
    });

    describe('Finalize', function () {
      it('should success', async function () {
        const receipt = await implementation.finalize();
        const block = await ethers.provider.getBlock(receipt.blockNumber!);
        const timestamp = BigNumber.from(block.timestamp);

        // check add denomication to list
        expect(await implementation.getAssetList()).to.be.deep.eq([
          denomination.address,
        ]);

        // check management fee initilize
        const lastMFeeClaimTime =
          await implementation.callStatic.lastMFeeClaimTime();
        expect(lastMFeeClaimTime).to.be.eq(timestamp);

        // check performance fee initilize
        const lastGrossSharePrice =
          await implementation.callStatic.lastGrossSharePrice64x64();
        const hwm64x64 = await implementation.callStatic.hwm64x64();
        expect(lastGrossSharePrice).to.be.eq(BigNumber.from(FEE_BASE64x64));
        expect(lastGrossSharePrice).to.be.eq(hwm64x64);

        // check vault approval
        const allowance = await denomination.allowance(
          vault.address,
          implementation.address
        );
        expect(allowance).to.be.eq(constants.MaxUint256);
      });

      it('should revert: finalize by non-owner', async function () {
        await expect(
          implementation.connect(user).finalize()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: finalize after denomination is forbidden', async function () {
        await comptroller.forbidDenominations([denomination.address]);
        // TODO: replace err msg: Invalid denomination
        await expect(implementation.finalize()).to.be.revertedWith('I');
      });
    });

    it('resume', async function () {
      await implementation.finalize();
      await implementation.pendMock();
      await expect(implementation.resume())
        .to.emit(implementation, 'StateTransited')
        .withArgs(POOL_STATE.EXECUTING);
      expect(await implementation.getAssetList()).to.be.deep.eq([
        denomination.address,
      ]);
      expect(await implementation.pendingStartTime()).to.be.eq(0);
    });

    describe('Liquidate', function () {
      it('liquidate', async function () {
        await implementation.finalize();
        await implementation.pendMock();
        await network.provider.send('evm_increaseTime', [pendingExpiration]);
        await expect(implementation.liquidate())
          .to.emit(implementation, 'StateTransited')
          .withArgs(POOL_STATE.LIQUIDATING)
          .to.emit(implementation, 'OwnershipTransferred')
          .withArgs(owner.address, liquidator.address);
        expect(await implementation.pendingStartTime()).to.be.eq(0);
      });

      it('liquidate by user', async function () {
        await implementation.finalize();
        await implementation.pendMock();
        await network.provider.send('evm_increaseTime', [pendingExpiration]);
        await expect(implementation.connect(user).liquidate())
          .to.emit(implementation, 'StateTransited')
          .withArgs(POOL_STATE.LIQUIDATING)
          .to.emit(implementation, 'OwnershipTransferred')
          .withArgs(owner.address, liquidator.address);
      });

      it('should revert: pending does not start', async function () {
        await implementation.finalize();
        await expect(implementation.liquidate()).to.be.revertedWith(
          // TODO: replace err msg: Pending does not start
          'P'
        );
      });

      it('should revert: pending does not expire', async function () {
        await implementation.finalize();
        await implementation.pendMock();
        await expect(implementation.liquidate()).to.be.revertedWith(
          // TODO: replace err msg: Pending does not expire
          'P'
        );
      });
    });

    describe('Close', function () {
      it('close when executing', async function () {
        await implementation.finalize();
        await expect(implementation.close())
          .to.emit(implementation, 'StateTransited')
          .withArgs(POOL_STATE.CLOSED);
      });

      it('should revert: close by non-owner', async function () {
        await expect(implementation.connect(user).close()).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });
  });

  describe('Asset module', function () {
    beforeEach(async function () {
      await implementation.finalize();
    });

    describe('add asset', function () {
      it('should succeed when amount > dust', async function () {
        // Permit asset
        await comptroller.permitAssets(level, [tokenA.address, tokenB.address]);

        // Transfer asset to vault
        await tokenA
          .connect(tokenAProvider)
          .transfer(vault.address, tokenAAmount);

        // Add asset
        await implementation.addAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.be.deep.eq([
          denomination.address,
          tokenA.address,
        ]);
      });

      it('should succeed when amount = dust ', async function () {
        const dustAmount = await assetRouter.calcAssetValue(
          denomination.address,
          denominationDust.add(mwei('0.000001')),
          tokenA.address
        );

        await comptroller.permitAssets(level, [tokenA.address]);
        await tokenA
          .connect(tokenAProvider)
          .transfer(vault.address, dustAmount);

        expect(await implementation.getAssetValue(tokenA.address)).to.be.eq(
          denominationDust
        );

        await implementation.addAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.be.deep.eq([
          denomination.address,
          tokenA.address,
        ]);
      });

      it('add debt asset ', async function () {
        await comptroller.permitAssets(level, [tokenC.address]);
        await tokenC
          .connect(tokenCProvider)
          .transfer(vault.address, BigNumber.from('1'));
        await implementation.addAsset(tokenC.address);
        expect(await implementation.getAssetList()).to.deep.include(
          tokenC.address
        );
      });

      it('should revert: add by non-owner', async function () {
        await expect(
          implementation.connect(user).addAsset(tokenA.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: asset is not permitted', async function () {
        await expect(
          implementation.addAsset(tokenA.address)
          // TODO: replace err msg: Invalid asset
        ).to.be.revertedWith('I');
      });

      it('can not be added: zero balance of asset', async function () {
        await comptroller.permitAssets(level, [tokenA.address]);
        await implementation.addAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.not.include(
          tokenA.address
        );
      });

      it('can not be added: balance of asset < dust ', async function () {
        const dustAmount = await assetRouter.calcAssetValue(
          denomination.address,
          denominationDust.sub(BigNumber.from('10')),
          tokenA.address
        );

        await comptroller.permitAssets(level, [tokenA.address]);
        await tokenA
          .connect(tokenAProvider)
          .transfer(vault.address, dustAmount);

        await implementation.addAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.not.include(
          tokenA.address
        );
      });
    });

    describe('remove asset', function () {
      beforeEach(async function () {
        // Permit asset
        await comptroller.permitAssets(level, [
          tokenA.address,
          tokenC.address,
          denomination.address,
        ]);

        // Transfer asset to vault
        await tokenA
          .connect(tokenAProvider)
          .transfer(vault.address, tokenAAmount);
        await tokenC
          .connect(tokenCProvider)
          .transfer(vault.address, tokenAAmount);

        await denomination
          .connect(denominationProvider)
          .transfer(vault.address, denominationDust.mul(2));

        // Add asset
        await implementation.addAsset(tokenA.address);
        await implementation.addAsset(tokenC.address);
        await implementation.addAsset(denomination.address);
      });

      it('normal', async function () {
        // Drain vault by sending token back to owner
        const amount = await tokenA.balanceOf(vault.address);
        const data = simpleEncode('transfer(address,uint256)', [
          owner.address,
          amount,
        ]);
        await implementation.vaultCallMock(tokenA.address, data);
        await implementation.removeAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.not.include(
          tokenA.address
        );
      });

      it('dust balance of asset', async function () {
        const dustAmount = await assetRouter.calcAssetValue(
          denomination.address,
          denominationDust,
          tokenA.address
        );

        // Drain vault by sending token back to owner
        const data = simpleEncode('transfer(address,uint256)', [
          owner.address,
          tokenAAmount.sub(dustAmount.div(2)),
        ]);
        await implementation.vaultCallMock(tokenA.address, data);
        await implementation.removeAsset(tokenA.address);

        expect(await implementation.getAssetList()).to.not.include(
          tokenA.address
        );
      });

      it('should revert: remove by non-owner', async function () {
        await expect(
          implementation.connect(user).removeAsset(tokenA.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('can not be removed: balance of asset > dust ', async function () {
        await implementation.removeAsset(tokenA.address);
        expect(await implementation.getAssetList()).to.deep.include(
          tokenA.address
        );
      });

      it('can not be removed: denomination', async function () {
        await implementation.removeAsset(denomination.address);
        expect(await implementation.getAssetList()).to.deep.include(
          denomination.address
        );
      });

      it('can not be removed: debt < zero', async function () {
        await implementation.removeAsset(tokenC.address);
        expect(await implementation.getAssetList()).to.deep.include(
          tokenC.address
        );
      });
    });
  });

  describe('Execute module', function () {
    const valueBefore = ethers.utils.parseEther('1');

    beforeEach(async function () {
      await implementation.finalize();
      await implementation.setLastTotalAssetValue(valueBefore);
    });

    it('should success', async function () {
      const valueCurrent = valueBefore.mul(valueTolerance).div(TOLERANCE_BASE);
      await implementation.setTotalAssetValueMock(valueCurrent);
      const executionData = action.interface.encodeFunctionData('fooAddress');
      await implementation.execute(executionData);
    });

    it('should revert when exceed tolerance', async function () {
      const valueCurrent = valueBefore
        .mul(valueTolerance - 1)
        .div(TOLERANCE_BASE);
      await implementation.setTotalAssetValueMock(valueCurrent);
      const executionData = action.interface.encodeFunctionData('fooAddress');
      await expect(implementation.execute(executionData)).to.be.revertedWith(
        'I'
      );
    });
  });

  describe('Setters', function () {
    describe('Denomination', function () {
      it('set denomination', async function () {
        await comptroller.permitDenominations([tokenA.address], [tokenAAmount]);
        await implementation.setDenomination(tokenA.address);
        expect(await implementation.denomination()).to.be.eq(tokenA.address);
      });

      it('should revert: set denomination at wrong stage', async function () {
        await implementation.finalize();
        await expect(
          implementation.setDenomination(tokenA.address)
        ).to.be.revertedWith('InvalidState(2)');
      });

      it('should revert: set by non-owner', async function () {
        await expect(
          implementation.connect(user).setDenomination(tokenA.address)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: set by zero address', async function () {
        await expect(
          implementation.setDenomination(constants.AddressZero)
          // TODO: replace err msg: Invalid denomination
        ).to.be.revertedWith('I');
      });
    });

    describe('Management Fee Rate', function () {
      const feeRate = BigNumber.from('1000');

      it('set management fee rate', async function () {
        await implementation.setManagementFeeRate(feeRate);
        expect(await implementation.getManagementFeeRate()).to.be.eq(
          BigNumber.from('18446744135297203117')
        );
      });

      it('should revert: set management fee rate at wrong stage', async function () {
        await implementation.finalize();
        await expect(
          implementation.setManagementFeeRate(feeRate)
        ).to.be.revertedWith('InvalidState(2)');
      });

      it('should revert: set by non-owner', async function () {
        await expect(
          implementation.connect(user).setManagementFeeRate(feeRate)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: set by max value', async function () {
        const maxRate = 1e4;
        await expect(
          implementation.setManagementFeeRate(maxRate)
          // TODO: replace err msg: fee rate should be less than 100%
        ).to.be.revertedWith('f');
      });
    });

    describe('Performance Fee Rate', function () {
      const feeRate = 0;

      it('set performance fee rate', async function () {
        await implementation.setPerformanceFeeRate(feeRate);
        expect(await implementation.getPerformanceFeeRate()).to.be.eq(0);
      });

      it('should revert: set performance fee rate at wrong stage', async function () {
        await implementation.finalize();
        await expect(
          implementation.setPerformanceFeeRate(feeRate)
        ).to.be.revertedWith('InvalidState(2)');
      });

      it('should revert: set by non-owner', async function () {
        await expect(
          implementation.connect(user).setPerformanceFeeRate(feeRate)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: set by max value', async function () {
        const maxRate = 1e4;
        await expect(
          implementation.setPerformanceFeeRate(maxRate)
          // TODO: replace err msg: fee rate should be less than 100%
        ).to.be.revertedWith('f');
      });
    });

    describe('Crystallization Period', function () {
      const period = CRYSTALLIZATION_PERIOD_MIN + 1000;

      it('set crystallization period', async function () {
        await implementation.setCrystallizationPeriod(period);
        expect(await implementation.getCrystallizationPeriod()).to.be.eq(
          period
        );
      });

      it('should revert: set crystallization period at wrong stage', async function () {
        await implementation.finalize();
        await expect(
          implementation.setCrystallizationPeriod(period)
        ).to.be.revertedWith('InvalidState(2)');
      });

      it('should revert: set by non-owner', async function () {
        await expect(
          implementation.connect(user).setCrystallizationPeriod(period)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should revert: set by too short period', async function () {
        const shortPeriod = CRYSTALLIZATION_PERIOD_MIN - 1;
        await expect(
          implementation.setCrystallizationPeriod(shortPeriod)
          // TODO: replace err msg: Crystallization period too short
        ).to.be.revertedWith('C');
      });
    });

    describe('Reserve Execution', function () {
      it('set reserve execution', async function () {
        await implementation.setReserveExecutionRatio(denominationDust);
        expect(await implementation.reserveExecutionRatio()).to.be.eq(
          denominationDust
        );
      });

      it('should revert: set reserve execution at wrong stage', async function () {
        await implementation.finalize();
        await expect(
          implementation.setReserveExecutionRatio(denominationDust)
        ).to.be.revertedWith('InvalidState(2)');
      });

      it('should revert: set by non-owner', async function () {
        await expect(
          implementation
            .connect(user)
            .setReserveExecutionRatio(denominationDust)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('Getters', function () {
    beforeEach(async function () {
      await implementation.finalize();
    });

    it('get asset total value', async function () {
      // Get expected amount
      const expectedA = await oracle.calcConversionAmount(
        tokenA.address,
        tokenAAmount,
        denomination.address
      );
      const expectedB = await oracle.calcConversionAmount(
        tokenB.address,
        tokenBAmount,
        denomination.address
      );

      // Permit asset
      await comptroller.permitAssets(level, [tokenA.address, tokenB.address]);

      // Transfer assets to vault
      await tokenA
        .connect(tokenAProvider)
        .transfer(vault.address, tokenAAmount);
      await tokenB
        .connect(tokenBProvider)
        .transfer(vault.address, tokenBAmount);

      // Add assets to tracking list
      await implementation.addAsset(tokenA.address);
      await implementation.addAsset(tokenB.address);

      const value = await implementation.getTotalAssetValue();
      expect(value).to.be.eq(expectedA.add(expectedB));
    });

    it('zero total value', async function () {
      expect(await implementation.getTotalAssetValue()).to.be.eq(0);
    });
  });

  describe('Reserve', function () {
    const reserveBase = FEE_BASE;
    let currentReserve = constants.Zero;

    beforeEach(async function () {
      currentReserve = await transferAssetToVault();
      implementation.reviewingMock();
    });

    async function transferAssetToVault() {
      await implementation.finalize();

      // Transfer asset to vault
      const expectedA = await oracle.calcConversionAmount(
        tokenA.address,
        tokenAAmount,
        denomination.address
      );
      const expectedB = await oracle.calcConversionAmount(
        tokenB.address,
        tokenBAmount,
        denomination.address
      );

      // Permit asset
      await comptroller.permitAssets(level, [tokenA.address, tokenB.address]);

      // Transfer assets to vault
      await tokenA
        .connect(tokenAProvider)
        .transfer(vault.address, tokenAAmount);
      await tokenB
        .connect(tokenBProvider)
        .transfer(vault.address, tokenBAmount);

      // Add assets to tracking list
      await implementation.addAsset(tokenA.address);
      await implementation.addAsset(tokenB.address);

      const value = await implementation.getTotalAssetValue();
      expect(value).to.be.eq(expectedA.add(expectedB));

      // Transfer 10% of total asset value, this makes currentReserve percentage close to 1/11.
      const denominationReserve = value.div(10);
      await denomination
        .connect(denominationProvider)
        .transfer(vault.address, denominationReserve);

      const totalAssetValue = await implementation.getTotalAssetValue();
      const currentReserve = denominationReserve
        .mul(reserveBase)
        .div(totalAssetValue);

      return currentReserve;
    }

    it('reserve is totally enough', async function () {
      await implementation.setReserveExecutionRatio(100); // 1%
      expect(await implementation.isReserveEnough()).to.be.eq(true);
    });

    it('reserve is a little bit more than setting', async function () {
      await implementation.setReserveExecutionRatio(currentReserve.sub(5)); // reserveExecution is 0.05% below currentReserve
      expect(await implementation.isReserveEnough()).to.be.eq(true);
    });

    it('reserve is totally not enough', async function () {
      await implementation.setReserveExecutionRatio(1500); // 15%
      expect(await implementation.isReserveEnough()).to.be.eq(false);
    });

    it('reserve is a little bit less than setting', async function () {
      await implementation.setReserveExecutionRatio(currentReserve.add(5)); // reserveExecution is 0.05% above currentReserve
      expect(await implementation.isReserveEnough()).to.be.eq(false);
    });
  });
});
