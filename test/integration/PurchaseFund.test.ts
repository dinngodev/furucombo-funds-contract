import { Wallet, Signer, BigNumber } from 'ethers';
import { deployments, network } from 'hardhat';
import { expect } from 'chai';
import {
  FurucomboRegistry,
  FurucomboProxy,
  FundImplementation,
  IERC20,
  HFunds,
  AFurucombo,
  TaskExecutor,
  ShareToken,
  HQuickSwap,
  IComptroller,
  Chainlink,
} from '../../typechain';

import { mwei, impersonateAndInjectEther, increaseNextBlockTimeBy, expectEqWithinBps } from '../utils/utils';
import {
  createFund,
  purchaseFund,
  redeemFund,
  setPendingAssetFund,
  setExecutingAssetFund,
  setLiquidatingAssetFund,
  setClosedDenominationFund,
} from './fund';

import { deployFurucomboProxyAndRegistry } from './deploy';
import {
  BAT_TOKEN,
  USDC_TOKEN,
  WETH_TOKEN,
  DAI_TOKEN,
  CHAINLINK_DAI_USD,
  CHAINLINK_USDC_USD,
  CHAINLINK_ETH_USD,
  USDC_PROVIDER,
  FUND_STATE,
  ONE_DAY,
  FUND_PERCENTAGE_BASE,
  MINIMUM_SHARE,
} from '../utils/constants';

describe('InvestorPurchaseFund', function () {
  let owner: Wallet;
  let collector: Wallet;
  let manager: Wallet;
  let liquidator: Wallet;
  let denominationProvider: Signer;
  let user0: Wallet, user1: Wallet, user2: Wallet, user3: Wallet;

  const denominationProviderAddress = USDC_PROVIDER;
  const denominationAddress = USDC_TOKEN;
  const mortgageAddress = BAT_TOKEN;
  const tokenAAddress = DAI_TOKEN;
  const tokenBAddress = WETH_TOKEN;

  const denominationAggregator = CHAINLINK_USDC_USD;
  const tokenAAggregator = CHAINLINK_DAI_USD;
  const tokenBAggregator = CHAINLINK_ETH_USD;

  const level = 1;
  const mortgageAmount = 0;
  const mFeeRate = 0;
  const mFeeRate10Percent = 1000;
  const pFeeRate = 0;
  const execFeePercentage = FUND_PERCENTAGE_BASE * 0.02; // 2%
  const pendingExpiration = ONE_DAY;
  const valueTolerance = 0;
  const crystallizationPeriod = 300; // 5m

  const initialFunds = mwei('6000');

  const shareTokenName = 'TEST';

  let fRegistry: FurucomboRegistry;
  let furucombo: FurucomboProxy;
  let comptroller: IComptroller;
  let hFunds: HFunds;
  let aFurucombo: AFurucombo;
  let taskExecutor: TaskExecutor;
  let oracle: Chainlink;
  let fundProxy: FundImplementation;
  let fundVault: string;
  let hQuickSwap: HQuickSwap;

  let denomination: IERC20;
  let shareToken: ShareToken;

  async function getExpectedShareWhenPending(amount: BigNumber) {
    const share = await fundProxy.calculateShare(amount);
    const bonus = await getPendingBonus(share);
    return share.add(bonus);
  }

  async function getPendingBonus(share: BigNumber) {
    const currentTotalPendingBonus = await fundProxy.currentTotalPendingBonus();
    const penalty = await comptroller.pendingPenalty();

    let bonus = share.mul(penalty).div(BigNumber.from(FUND_PERCENTAGE_BASE).sub(penalty));
    bonus = currentTotalPendingBonus > bonus ? bonus : currentTotalPendingBonus;
    return bonus;
  }

  describe('Funds without management fee', function () {
    const purchaseAmount = mwei('2000');
    const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
      await deployments.fixture(''); // ensure you start from a fresh deployments
      [owner, collector, manager, user0, user1, user2, user3, liquidator] = await (ethers as any).getSigners();

      // Setup tokens and providers
      denominationProvider = await impersonateAndInjectEther(denominationProviderAddress);

      // Deploy furucombo
      [fRegistry, furucombo] = await deployFurucomboProxyAndRegistry();

      // Deploy furucombo funds contracts
      [
        fundProxy,
        fundVault,
        denomination,
        shareToken,
        taskExecutor,
        aFurucombo,
        hFunds,
        ,
        ,
        oracle,
        comptroller,
        ,
        hQuickSwap,
        ,
      ] = await createFund(
        owner,
        collector,
        manager,
        liquidator,
        denominationAddress,
        mortgageAddress,
        tokenAAddress,
        tokenBAddress,
        denominationAggregator,
        tokenAAggregator,
        tokenBAggregator,
        level,
        mortgageAmount,
        mFeeRate,
        pFeeRate,
        execFeePercentage,
        pendingExpiration,
        valueTolerance,
        crystallizationPeriod,
        shareTokenName,
        fRegistry,
        furucombo
      );

      // Transfer token to users
      await denomination.connect(denominationProvider).transfer(user0.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user1.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user2.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user3.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(manager.address, initialFunds);
    });

    beforeEach(async function () {
      await setupTest();
    });

    describe('Without state change', function () {
      describe('Executing state', function () {
        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const user1ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user1Share, state] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount));
          expect(user1Share).to.be.eq(purchaseAmount.sub(MINIMUM_SHARE)); // initial mint, share = purchaseAmount - MINIMUM_SHARE
          expect(user1Share).to.be.eq(user1ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user2Share, state] = await purchaseFund(user2, fundProxy, denomination, shareToken, purchaseAmount);

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount.mul(BigNumber.from('2'))));

          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('user1, user2 and user3 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user2Share] = await purchaseFund(user2, fundProxy, denomination, shareToken, purchaseAmount);

          // user3 purchase
          const user3ExpectedShare = await fundProxy.calculateShare(purchaseAmount.mul(BigNumber.from('2')));
          const [user3Share, state] = await purchaseFund(
            user3,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount.mul(BigNumber.from('2'))
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount.mul(BigNumber.from('4'))));

          expect(user1Share).to.be.eq(user2Share.sub(MINIMUM_SHARE));
          expect(user3Share).to.be.eq(user1Share.add(user2Share).add(MINIMUM_SHARE));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user3Share).to.be.eq(user3ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('should revert: get 0 share', async function () {
          // manager purchase
          const [managerShare] = await purchaseFund(manager, fundProxy, denomination, shareToken, mwei('0.00101'));

          // transfer a lot amount to vault
          const badAmount = mwei('1000000');
          await denomination.connect(denominationProvider).transfer(fundVault, badAmount);

          // user1 buy
          const user1PurchaseAmount = mwei('0.1');
          await denomination.connect(user1).approve(fundProxy.address, user1PurchaseAmount);
          await expect(fundProxy.connect(user1).purchase(user1PurchaseAmount)).to.be.revertedWith('RevertCode(71)'); // SHARE_MODULE_PURCHASE_ZERO_SHARE
        });
      }); // describe('Executing state') ends

      describe('Pending state', function () {
        const swapAmount = purchaseAmount.div(2);
        const reserveAmount = purchaseAmount.sub(swapAmount);
        const redeemAmount = reserveAmount.add(mwei('500'));
        const pendingPurchaseAmount = mwei('100');

        beforeEach(async function () {
          await setPendingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            redeemAmount,
            execFeePercentage,
            denominationAddress,
            tokenAAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );
        });

        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share, state] = await purchaseFund(
            user1,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user2Share, state] = await purchaseFund(
            user2,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount.mul(2)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('user1, user2 and user3 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user2Share] = await purchaseFund(user2, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user3 purchase
          const user3ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount.mul(2));
          const [user3Share, state] = await purchaseFund(
            user3,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount.mul(2)
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount.mul(4)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user3Share).to.be.gte(user1Share.add(user2Share));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user3Share).to.be.eq(user3ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('get no bonus when in the same block with redeem', async function () {
          // purchase to make fund back to executing
          const user1PurchaseAmount = redeemAmount.sub(reserveAmount).add(mwei('100'));
          const [user1Share, state] = await purchaseFund(
            user1,
            fundProxy,
            denomination,
            shareToken,
            user1PurchaseAmount
          );
          expect(state).to.be.eq(FUND_STATE.EXECUTING);

          const expectedNoBonusShare = await fundProxy.calculateShare(purchaseAmount);

          // stop mining
          await network.provider.send('evm_setAutomine', [false]);

          // user0 sandwich user1
          const user0Share = await shareToken.balanceOf(user0.address);
          await redeemFund(user0, fundProxy, denomination, user0Share, true);

          await redeemFund(user1, fundProxy, denomination, user1Share, true);

          await purchaseFund(user0, fundProxy, denomination, shareToken, purchaseAmount);

          await network.provider.send('evm_mine', []);
          await network.provider.send('evm_setAutomine', [true]);

          const user0ShareAfter = await shareToken.balanceOf(user0.address);
          expectEqWithinBps(user0ShareAfter, expectedNoBonusShare, 10); // set 0.1% tolerance cause expectedNoBonusShare might have slightly diff(1 wei) due to BigNumber arithmetic.
        });
      }); // describe('Pending state') end

      describe('Executing state, funds with other asset', function () {
        const swapAmount = purchaseAmount.div(2);

        beforeEach(async function () {
          await setExecutingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            execFeePercentage,
            denominationAddress,
            tokenBAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );
        });

        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const user1ExpectedShare = await getExpectedShareWhenPending(purchaseAmount);
          const [user1Share, state] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount));
          expect(user1Share).to.be.eq(user1ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(purchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(purchaseAmount);
          const [user2Share, state] = await purchaseFund(user2, fundProxy, denomination, shareToken, purchaseAmount);
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount.mul(2)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('user1, user2 and user3 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(purchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(purchaseAmount);
          const [user2Share] = await purchaseFund(user2, fundProxy, denomination, shareToken, purchaseAmount);

          // user3 purchase
          const user3ExpectedShare = await getExpectedShareWhenPending(purchaseAmount.mul(2));
          const [user3Share, state] = await purchaseFund(
            user3,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount.mul(2)
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount.mul(4)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user3Share).to.be.eq(user1Share.add(user2Share));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user3Share).to.be.eq(user3ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });
      });

      describe('Pending state, funds with other asset', function () {
        const swapAmount = purchaseAmount.div(2);
        const reserveAmount = purchaseAmount.sub(swapAmount);
        const redeemAmount = reserveAmount.add(mwei('500'));
        const pendingPurchaseAmount = mwei('100');

        beforeEach(async function () {
          await setPendingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            redeemAmount,
            execFeePercentage,
            denominationAddress,
            tokenAAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );
        });

        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share, state] = await purchaseFund(
            user1,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user2Share, state] = await purchaseFund(
            user2,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount.mul(2)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('user1, user2 and user3 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user2Share] = await purchaseFund(user2, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user3 purchase
          const user3ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount.mul(2));
          const [user3Share, state] = await purchaseFund(
            user3,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount.mul(2)
          );
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount.mul(4)));

          expect(user1Share).to.be.eq(user2Share);
          expect(user3Share).to.be.gte(user1Share.add(user2Share));
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user3Share).to.be.eq(user3ExpectedShare);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });
      });
    }); // describe('Without state change') end

    describe('With state change', function () {
      const purchaseAmount = mwei('2000');

      describe('Pending -> Executing', function () {
        const swapAmount = purchaseAmount.div(2);
        const reserveAmount = purchaseAmount.sub(swapAmount);
        const redeemAmount = reserveAmount.add(mwei('500'));

        beforeEach(async function () {
          await setPendingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            redeemAmount,
            execFeePercentage,
            denominationAddress,
            tokenAAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );
        });

        it('user1 purchase', async function () {
          const solvePendingPurchaseAmount = mwei('600');

          // Get states
          const user1ExpectedShare = await getExpectedShareWhenPending(solvePendingPurchaseAmount);
          const pendingRoundListLengthBefore = await fundProxy.currentPendingRound();

          const [user1Share, user1State] = await purchaseFund(
            user1,
            fundProxy,
            denomination,
            shareToken,
            solvePendingPurchaseAmount
          );

          // Verify states
          const pendingRoundListLengthAfter = await fundProxy.currentPendingRound();
          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user1State).to.be.eq(FUND_STATE.EXECUTING);
          expect(pendingRoundListLengthAfter.sub(pendingRoundListLengthBefore)).to.be.eq(1);
        });

        it('user1 and user2 purchase', async function () {
          const amount = mwei('100');
          const solvePendingPurchaseAmount = mwei('600');

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(amount);
          const [user1Share, user1State] = await purchaseFund(user1, fundProxy, denomination, shareToken, amount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(solvePendingPurchaseAmount);

          // Get pendingRoundList length
          const pendingRoundListLengthBefore = await fundProxy.currentPendingRound();

          const [user2Share, user2State] = await purchaseFund(
            user2,
            fundProxy,
            denomination,
            shareToken,
            solvePendingPurchaseAmount
          );

          const pendingRoundListLengthAfter = await fundProxy.currentPendingRound();

          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);

          expect(user1State).to.be.eq(FUND_STATE.PENDING);
          expect(user2State).to.be.eq(FUND_STATE.EXECUTING);
          expect(pendingRoundListLengthAfter.sub(pendingRoundListLengthBefore)).to.be.eq(1);
        });

        it('user1, user2 and user3 purchase', async function () {
          const amount = mwei('100');
          const solvePendingPurchaseAmount = mwei('600');

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(amount);
          const [user1Share, user1State] = await purchaseFund(user1, fundProxy, denomination, shareToken, amount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(amount);
          const [user2Share, user2State] = await purchaseFund(user2, fundProxy, denomination, shareToken, amount);

          // user3 purchase
          const user3ExpectedShare = await getExpectedShareWhenPending(solvePendingPurchaseAmount);

          // Get pendingRoundList length
          const pendingRoundListLengthBefore = await fundProxy.currentPendingRound();

          const [user3Share, user3State] = await purchaseFund(
            user3,
            fundProxy,
            denomination,
            shareToken,
            solvePendingPurchaseAmount
          );

          const pendingRoundListLengthAfter = await fundProxy.currentPendingRound();

          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user3Share).to.be.eq(user3ExpectedShare);

          expect(user1State).to.be.eq(FUND_STATE.PENDING);
          expect(user2State).to.be.eq(FUND_STATE.PENDING);
          expect(user3State).to.be.eq(FUND_STATE.EXECUTING);
          expect(pendingRoundListLengthAfter.sub(pendingRoundListLengthBefore)).to.be.eq(1);
        });
      });
    }); // describe('With state change') end

    describe('Dead oracle', function () {
      const purchaseAmount = mwei('2000');
      const swapAmount = purchaseAmount.div(2);

      describe('Executing state, funds with other asset', function () {
        beforeEach(async function () {
          await setExecutingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            execFeePercentage,
            denominationAddress,
            tokenBAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );

          await oracle.connect(owner).setStalePeriod(1);
          await increaseNextBlockTimeBy(ONE_DAY);
        });

        it('should revert: CHAINLINK_STALE_PRICE', async function () {
          await denomination.connect(user1).approve(fundProxy.address, mwei('100'));
          await expect(fundProxy.connect(user1).purchase(mwei('100'))).to.be.revertedWith('RevertCode(45)'); // CHAINLINK_STALE_PRICE
        });
      }); // describe('Dead oracle') end
    });
  });

  describe('Funds with management fee', function () {
    const purchaseAmount = mwei('2000');

    const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
      await deployments.fixture(''); // ensure you start from a fresh deployments
      [owner, collector, manager, user0, user1, user2, user3, liquidator] = await (ethers as any).getSigners();

      // Setup tokens and providers
      denominationProvider = await impersonateAndInjectEther(denominationProviderAddress);

      // Deploy furucombo
      [fRegistry, furucombo] = await deployFurucomboProxyAndRegistry();

      // Deploy furucombo funds contracts
      [
        fundProxy,
        fundVault,
        denomination,
        shareToken,
        taskExecutor,
        aFurucombo,
        hFunds,
        ,
        ,
        oracle,
        comptroller,
        ,
        hQuickSwap,
        ,
      ] = await createFund(
        owner,
        collector,
        manager,
        liquidator,
        denominationAddress,
        mortgageAddress,
        tokenAAddress,
        tokenBAddress,
        denominationAggregator,
        tokenAAggregator,
        tokenBAggregator,
        level,
        mortgageAmount,
        mFeeRate10Percent,
        pFeeRate,
        execFeePercentage,
        pendingExpiration,
        valueTolerance,
        crystallizationPeriod,
        shareTokenName,
        fRegistry,
        furucombo
      );

      // Transfer token to users
      await denomination.connect(denominationProvider).transfer(user0.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user1.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user2.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user3.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(manager.address, initialFunds);
    });

    beforeEach(async function () {
      await setupTest();
    });

    describe('Without state change', function () {
      describe('Executing state', function () {
        beforeEach(async function () {
          [
            fundProxy,
            fundVault,
            denomination,
            shareToken,
            taskExecutor,
            aFurucombo,
            hFunds,
            ,
            ,
            oracle,
            comptroller,
            ,
            hQuickSwap,
            ,
          ] = await createFund(
            owner,
            collector,
            manager,
            liquidator,
            denominationAddress,
            mortgageAddress,
            tokenAAddress,
            tokenBAddress,
            denominationAggregator,
            tokenAAggregator,
            tokenBAggregator,
            level,
            mortgageAmount,
            mFeeRate10Percent,
            pFeeRate,
            execFeePercentage,
            pendingExpiration,
            valueTolerance,
            crystallizationPeriod,
            shareTokenName,
            fRegistry,
            furucombo
          );
        });

        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const managerShareBalanceBefore = await shareToken.balanceOf(manager.address);
          const user1ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user1Share, state] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);
          const managerShareBalanceAfter = await shareToken.balanceOf(manager.address);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount));
          expect(user1Share).to.be.eq(purchaseAmount.sub(MINIMUM_SHARE)); // initial mint, share = purchaseAmount - MINIMUM_SHARE
          expect(user1Share).to.be.eq(user1ExpectedShare);

          // initial mint, manager shouldn't get management fee
          expect(managerShareBalanceAfter.sub(managerShareBalanceBefore)).to.be.eq(0);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const managerShareBalanceBefore = await shareToken.balanceOf(manager.address);

          // user1 purchase
          const user1ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, purchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await fundProxy.calculateShare(purchaseAmount);
          const [user2Share, state] = await purchaseFund(user2, fundProxy, denomination, shareToken, purchaseAmount);

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);
          const managerShareBalanceAfter = await shareToken.balanceOf(manager.address);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(purchaseAmount.mul(BigNumber.from('2'))));

          expect(user1Share).to.be.eq(user1ExpectedShare);
          expectEqWithinBps(user2Share, user2ExpectedShare, 10); // Didn't include management fee when calculate user2ExpectedShare, but they should really close
          expect(user2Share).to.be.gt(user1Share); // user2 purchase after user1, user2's share should greater than user1's share

          // manager should get some management fee
          expect(managerShareBalanceAfter.sub(managerShareBalanceBefore)).to.be.gt(0);

          expect(state).to.be.eq(FUND_STATE.EXECUTING);
        });
      });

      describe('Pending state', function () {
        const swapAmount = purchaseAmount.div(2);
        const reserveAmount = purchaseAmount.sub(swapAmount);
        const redeemAmount = reserveAmount.add(mwei('500'));
        const pendingPurchaseAmount = mwei('100');

        beforeEach(async function () {
          [
            fundProxy,
            fundVault,
            denomination,
            shareToken,
            taskExecutor,
            aFurucombo,
            hFunds,
            ,
            ,
            oracle,
            comptroller,
            ,
            hQuickSwap,
            ,
          ] = await createFund(
            owner,
            collector,
            manager,
            liquidator,
            denominationAddress,
            mortgageAddress,
            tokenAAddress,
            tokenBAddress,
            denominationAggregator,
            tokenAAggregator,
            tokenBAggregator,
            level,
            mortgageAmount,
            mFeeRate10Percent,
            pFeeRate,
            execFeePercentage,
            pendingExpiration,
            valueTolerance,
            crystallizationPeriod,
            shareTokenName,
            fRegistry,
            furucombo
          );

          await setPendingAssetFund(
            manager,
            user0,
            fundProxy,
            denomination,
            shareToken,
            purchaseAmount,
            swapAmount,
            redeemAmount,
            execFeePercentage,
            denominationAddress,
            tokenAAddress,
            hFunds,
            aFurucombo,
            taskExecutor,
            hQuickSwap
          );
        });

        it('user1 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const managerShareBalanceBefore = await shareToken.balanceOf(manager.address);
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share, state] = await purchaseFund(
            user1,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );
          const vaultBalanceAfter = await denomination.balanceOf(fundVault);
          const managerShareBalanceAfter = await shareToken.balanceOf(manager.address);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount));
          expect(user1Share).to.be.eq(user1ExpectedShare);

          // manager shouldn't get management fee when pending state
          expect(managerShareBalanceAfter.sub(managerShareBalanceBefore)).to.be.eq(0);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });

        it('user1 and user2 purchase', async function () {
          const vaultBalanceBefore = await denomination.balanceOf(fundVault);
          const managerShareBalanceBefore = await shareToken.balanceOf(manager.address);

          // user1 purchase
          const user1ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user1Share] = await purchaseFund(user1, fundProxy, denomination, shareToken, pendingPurchaseAmount);

          // user2 purchase
          const user2ExpectedShare = await getExpectedShareWhenPending(pendingPurchaseAmount);
          const [user2Share, state] = await purchaseFund(
            user2,
            fundProxy,
            denomination,
            shareToken,
            pendingPurchaseAmount
          );

          const vaultBalanceAfter = await denomination.balanceOf(fundVault);
          const managerShareBalanceAfter = await shareToken.balanceOf(manager.address);

          expect(vaultBalanceAfter).to.be.eq(vaultBalanceBefore.add(pendingPurchaseAmount.mul(BigNumber.from('2'))));

          expect(user1Share).to.be.eq(user1ExpectedShare);
          expect(user2Share).to.be.eq(user2ExpectedShare);
          expect(user2Share).to.be.eq(user1Share);

          // manager shouldn't get management fee when pending state
          expect(managerShareBalanceAfter.sub(managerShareBalanceBefore)).to.be.eq(0);

          expect(state).to.be.eq(FUND_STATE.PENDING);
        });
      });
    }); // describe('Without state change') end
  }); // describe('Funds with management fee') end

  describe('Other should revert cases', function () {
    const purchaseAmount = mwei('2000');
    const swapAmount = purchaseAmount.div(2);
    const redeemAmount = purchaseAmount.sub(MINIMUM_SHARE);

    const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
      await deployments.fixture(''); // ensure you start from a fresh deployments
      [owner, collector, manager, user0, user1, liquidator] = await (ethers as any).getSigners();

      // Setup tokens and providers
      denominationProvider = await impersonateAndInjectEther(denominationProviderAddress);

      // Deploy furucombo
      [fRegistry, furucombo] = await deployFurucomboProxyAndRegistry();

      // Deploy furucombo funds contracts
      [
        fundProxy,
        fundVault,
        denomination,
        shareToken,
        taskExecutor,
        aFurucombo,
        hFunds,
        ,
        ,
        oracle,
        comptroller,
        ,
        hQuickSwap,
        ,
      ] = await createFund(
        owner,
        collector,
        manager,
        liquidator,
        denominationAddress,
        mortgageAddress,
        tokenAAddress,
        tokenBAddress,
        denominationAggregator,
        tokenAAggregator,
        tokenBAggregator,
        level,
        mortgageAmount,
        mFeeRate,
        pFeeRate,
        execFeePercentage,
        pendingExpiration,
        valueTolerance,
        crystallizationPeriod,
        shareTokenName,
        fRegistry,
        furucombo
      );

      // Transfer token to users
      await denomination.connect(denominationProvider).transfer(user0.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(user1.address, initialFunds);
      await denomination.connect(denominationProvider).transfer(manager.address, initialFunds);
    });

    beforeEach(async function () {
      await setupTest();
    });

    it('should revert: purchase when fund in liquidating', async function () {
      await setLiquidatingAssetFund(
        manager,
        user0,
        liquidator,
        fundProxy,
        denomination,
        shareToken,
        purchaseAmount,
        swapAmount,
        redeemAmount,
        execFeePercentage,
        denominationAddress,
        tokenAAddress,
        hFunds,
        aFurucombo,
        taskExecutor,
        oracle,
        hQuickSwap,
        pendingExpiration
      );

      await denomination.connect(user1).approve(fundProxy.address, purchaseAmount);
      await expect(fundProxy.connect(user1).purchase(purchaseAmount)).to.be.revertedWith('InvalidState(4)'); // LIQUIDATING
    });

    it('should revert: purchase when fund in close', async function () {
      await setClosedDenominationFund(manager, user0, fundProxy, denomination, shareToken, purchaseAmount);
      await denomination.connect(user1).approve(fundProxy.address, purchaseAmount);
      await expect(fundProxy.connect(user1).purchase(purchaseAmount)).to.be.revertedWith('InvalidState(5)'); // CLOSED
    });
  });
});
