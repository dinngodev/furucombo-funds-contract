import { Wallet, BigNumber } from 'ethers';
import { expect } from 'chai';
import { ethers, deployments } from 'hardhat';
import { PerformanceFeeModuleMock, ShareToken } from '../typechain';
import { OUTSTANDING_ACCOUNT, FUND_PERCENTAGE_BASE } from './utils/constants';
import { increaseNextBlockTimeBy, get64x64FromNumber, ether, expectEqWithinBps } from './utils/utils';

describe('Performance fee', function () {
  let pFeeModule: PerformanceFeeModuleMock;
  let user: Wallet;
  let manager: Wallet;
  let tokenS: ShareToken;
  let feeBase: BigNumber;

  const totalShare = ethers.utils.parseEther('100');
  const outstandingAccount = OUTSTANDING_ACCOUNT;

  const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
    await deployments.fixture('');
    [user, manager] = await (ethers as any).getSigners();
    pFeeModule = await (await ethers.getContractFactory('PerformanceFeeModuleMock')).connect(user).deploy();
    await pFeeModule.deployed();
    tokenS = await (await ethers.getContractFactory('ShareToken')).connect(user).deploy('ShareToken', 'SHT', 18);
    await tokenS.deployed();
    // initialize
    await pFeeModule.setShareToken(tokenS.address);
    await pFeeModule.transferOwnership(manager.address);
    await tokenS.transferOwnership(pFeeModule.address);
  });

  beforeEach(async function () {
    await setupTest();
    feeBase = await pFeeModule.getFeeBase();
  });

  describe('set performance fee rate', function () {
    it('zero', async function () {
      const feeRate = BigNumber.from('0');
      await pFeeModule.setPerformanceFeeRate(feeRate);
      const result = await pFeeModule.pFeeRate64x64();
      expect(result).to.be.eq(BigNumber.from('0'));
    });

    it('in normal range', async function () {
      const feeRate = BigNumber.from('1000');
      await pFeeModule.setPerformanceFeeRate(feeRate);
      const result = await pFeeModule.pFeeRate64x64();
      expect(result).to.be.eq(get64x64FromNumber(feeRate.toNumber() / FUND_PERCENTAGE_BASE));
    });

    it('should revert: equal to 100%', async function () {
      await expect(pFeeModule.setPerformanceFeeRate(feeBase)).to.be.reverted;
    });
  });

  describe('set crystallization period', function () {
    it('in normal range', async function () {
      const period = BigNumber.from(30 * 24 * 60 * 60);
      await pFeeModule.setCrystallizationPeriod(period);
      const result = await pFeeModule.crystallizationPeriod();
      expect(result).to.be.eq(period);
    });

    it('should revert: equal to 0', async function () {
      await expect(pFeeModule.setCrystallizationPeriod(0)).to.be.revertedWith('C');
    });
  });

  describe('get crystallize time', function () {
    const period = BigNumber.from(4 * 30 * 24 * 60 * 60);
    let startTime: BigNumber;

    beforeEach(async function () {
      await pFeeModule.setCrystallizationPeriod(period);
      const receipt = await pFeeModule.initializePerformanceFee();
      const block = await ethers.provider.getBlock(receipt.blockNumber!);
      startTime = BigNumber.from(block.timestamp);
    });

    it('shoud return next period time before period', async function () {
      await increaseNextBlockTimeBy(period.toNumber() * 0.4);
      const isCrystallizable = await pFeeModule.isCrystallizable();
      const nextCrystallizeTime = await pFeeModule.getNextCrystallizationTime();
      expect(isCrystallizable).to.be.eq(false);
      expect(nextCrystallizeTime).to.be.eq(startTime.add(period));
    });
    it('shoud return next period time after period', async function () {
      await increaseNextBlockTimeBy(period.toNumber() * 1.8);
      const isCrystallizable = await pFeeModule.isCrystallizable();
      const nextCrystallizeTime = await pFeeModule.getNextCrystallizationTime();
      expect(isCrystallizable).to.be.eq(true);
      expect(nextCrystallizeTime).to.be.eq(startTime.add(period));
    });

    it('shoud return earliest next period time at next period', async function () {
      await increaseNextBlockTimeBy(period.toNumber() * 2.2);
      const isCrystallizable = await pFeeModule.isCrystallizable();
      const nextCrystallizeTime = await pFeeModule.getNextCrystallizationTime();
      expect(isCrystallizable).to.be.eq(true);
      expect(nextCrystallizeTime).to.be.eq(startTime.add(period));
    });
  });

  describe('performance fee calculation', function () {
    const period = BigNumber.from(4 * 30 * 24 * 60 * 60);
    const grossAssetValue = totalShare;

    beforeEach(async function () {
      await pFeeModule.setCrystallizationPeriod(period);
      await pFeeModule.setGrossAssetValue(grossAssetValue);
      await pFeeModule.mintShareToken(user.address, totalShare);
    });

    describe('update performance fee', function () {
      let feeRate: BigNumber;
      let growth: BigNumber;
      let currentGrossAssetValue: BigNumber;

      it('should not update fee when rate is 0', async function () {
        feeRate = BigNumber.from('0');
        growth = grossAssetValue;
        currentGrossAssetValue = grossAssetValue.add(growth);
        await pFeeModule.setPerformanceFeeRate(feeRate);
        await pFeeModule.initializePerformanceFee();
        await pFeeModule.setGrossAssetValue(currentGrossAssetValue);
        await pFeeModule.updatePerformanceFee();
        const outstandingShare = await tokenS.balanceOf('0x0000000000000000000000000000000000000001');
        expect(outstandingShare).to.be.eq(BigNumber.from('0'));
      });

      it('update fee when fee rate is valid', async function () {
        feeRate = BigNumber.from('1000');
        growth = grossAssetValue;
        currentGrossAssetValue = grossAssetValue.add(growth);
        await pFeeModule.setPerformanceFeeRate(feeRate);
        await pFeeModule.initializePerformanceFee();
        await pFeeModule.setGrossAssetValue(currentGrossAssetValue);
        await pFeeModule.updatePerformanceFee();
        const outstandingShare = await tokenS.balanceOf(outstandingAccount);

        const fee = growth.mul(feeRate).div(feeBase);
        const expectShare = fee.mul(totalShare).div(currentGrossAssetValue.sub(fee));
        expectEqWithinBps(outstandingShare, expectShare, 10);
      });

      describe('crystallization', function () {
        beforeEach(async function () {
          feeRate = BigNumber.from('1000');
          growth = grossAssetValue;
          currentGrossAssetValue = grossAssetValue.add(growth);
          await pFeeModule.setPerformanceFeeRate(feeRate);
          await pFeeModule.initializePerformanceFee();
          await pFeeModule.setGrossAssetValue(currentGrossAssetValue);
        });

        it('should not get fee when crystallization before period', async function () {
          await increaseNextBlockTimeBy(period.toNumber() * 0.4);
          const highWaterMarkBefore = await pFeeModule.hwm64x64();
          await expect(pFeeModule.crystallize()).to.be.revertedWith('RevertCode(65)'); // PERFORMANCE_FEE_MODULE_CAN_NOT_CRYSTALLIZED_YET;
          await pFeeModule.updatePerformanceFee();
          const shareManager = await tokenS.balanceOf(manager.address);
          expect(shareManager).to.be.eq(BigNumber.from(0));
          const highWaterMarkAfter = await pFeeModule.hwm64x64();
          expect(highWaterMarkAfter).to.be.eq(highWaterMarkBefore);
        });

        it('should get fee when crystallization after period', async function () {
          await increaseNextBlockTimeBy(period.toNumber());
          const highWaterMarkBefore = await pFeeModule.hwm64x64();
          await expect(pFeeModule.crystallize()).to.emit(pFeeModule, 'PerformanceFeeClaimed');
          const highWaterMarkAfter = await pFeeModule.hwm64x64();
          const shareManager = await tokenS.balanceOf(manager.address);
          const fee = growth.mul(feeRate).div(feeBase);
          const expectShare = fee.mul(totalShare).div(currentGrossAssetValue.sub(fee));
          const lastPrice = await pFeeModule.lastGrossSharePrice64x64();
          const expectPrice = highWaterMarkBefore.mul(feeBase.mul(2).sub(feeRate)).div(feeBase);

          expectEqWithinBps(shareManager, expectShare, 10);
          expect(highWaterMarkAfter).to.be.eq(lastPrice);
          expectEqWithinBps(highWaterMarkAfter, expectPrice, 10);
        });

        it('should get fee when crystallization at next period', async function () {
          await increaseNextBlockTimeBy(period.toNumber() * 1.8);
          await pFeeModule.crystallize();
          await increaseNextBlockTimeBy(period.toNumber() * 0.4);
          const highWaterMarkBefore = await pFeeModule.hwm64x64();
          await pFeeModule.crystallize();
          const highWaterMarkAfter = await pFeeModule.hwm64x64();
          const shareManager = await tokenS.balanceOf(manager.address);
          const fee = growth.mul(feeRate).div(feeBase);
          const expectShare = fee.mul(totalShare).div(currentGrossAssetValue.sub(fee));
          const lastPrice = await pFeeModule.lastGrossSharePrice64x64();
          expectEqWithinBps(shareManager, expectShare, 10);
          expect(highWaterMarkAfter).to.be.eq(lastPrice);
        });

        it('should get fee when crystallization after period', async function () {
          await increaseNextBlockTimeBy(period.toNumber());
          const highWaterMarkBefore = await pFeeModule.hwm64x64();
          await pFeeModule.crystallize();
          const highWaterMarkAfter = await pFeeModule.hwm64x64();
          const shareManager = await tokenS.balanceOf(manager.address);
          const fee = growth.mul(feeRate).div(feeBase);
          const expectShare = fee.mul(totalShare).div(currentGrossAssetValue.sub(fee));
          const lastPrice = await pFeeModule.lastGrossSharePrice64x64();
          const expectPrice = highWaterMarkBefore.mul(feeBase.mul(2).sub(feeRate)).div(feeBase);

          expectEqWithinBps(shareManager, expectShare, 10);
          expect(highWaterMarkAfter).to.be.eq(lastPrice);
          expectEqWithinBps(highWaterMarkAfter, expectPrice, 10);
        });

        it('should revert: time before start', async function () {
          const crystallizationStart = await pFeeModule.crystallizationStart();
          await expect(pFeeModule.timeToPeriod(crystallizationStart.sub(10))).to.be.revertedWith('RevertCode(66)'); // PERFORMANCE_FEE_MODULE_TIME_BEFORE_START
        });
      });

      describe('price changing cases', function () {
        const feeRate = BigNumber.from(1000);
        const valueOffset = ether('10');
        beforeEach(async function () {
          await pFeeModule.setPerformanceFeeRate(feeRate);
          await pFeeModule.initializePerformanceFee();
        });

        describe('among single period', function () {
          const timeOffset = period.toNumber() * 0.4;

          describe('from low to high', function () {
            it('hwm lower than the lower price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeBefore).to.be.gt(ether('0'));
              expect(pFeeAfter).to.be.gt(pFeeBefore);
            });

            it('hwm higher than the higher price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.eq(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });

            it('hwm between two prices', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.gt(pFeeBefore);
              expect(pFeeBefore).to.be.eq(ether('0'));
            });
          });

          describe('from high to low', function () {
            it('hwm lower than the lower price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.lt(pFeeBefore);
              expect(pFeeAfter).to.be.gt(ether('0'));
            });

            it('hwm higher than the higher price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.eq(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });

            it('hwm between two prices', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const pFeeAfter = await tokenS.balanceOf(outstandingAccount);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.lt(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });
          });
        });

        describe('cross period', function () {
          const timeOffset = period.toNumber() * 1.2;

          describe('from low to high', function () {
            it('hwm lower than the lower price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset.mul(2)));
              await pFeeModule.crystallize();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.gt(hwmBefore);
              expect(pFeeBefore).to.be.gt(ether('0'));
              expect(pFeeAfter).to.be.gt(pFeeBefore);
            });

            it('hwm higher than the higher price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.crystallize();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.eq(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });

            it('hwm between two prices', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.crystallize();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.gt(hwmBefore);
              expect(pFeeBefore).to.be.eq(ether('0'));
              expect(pFeeAfter).to.be.gt(pFeeBefore);
            });
          });

          describe('from high to low', function () {
            it('hwm lower than the lower price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset.mul(2)));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.crystallize();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.gt(hwmBefore);
              expect(pFeeAfter).to.be.lt(pFeeBefore);
              expect(pFeeAfter).to.be.gt(ether('0'));
            });

            it('hwm higher than the higher price', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset.mul(2)));
              await pFeeModule.crystallize();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.eq(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });

            it('hwm between two prices', async function () {
              // Set start price
              await pFeeModule.setGrossAssetValue(grossAssetValue.add(valueOffset));
              await pFeeModule.updatePerformanceFee();
              await increaseNextBlockTimeBy(timeOffset);
              // Get start state
              const hwmBefore = await pFeeModule.hwm64x64();
              const pFeeBefore = await tokenS.balanceOf(outstandingAccount);
              const ownerShareBefore = await tokenS.balanceOf(manager.address);
              // Set after price
              await pFeeModule.setGrossAssetValue(grossAssetValue.sub(valueOffset));
              await pFeeModule.updatePerformanceFee();
              // Get after state
              const hwmAfter = await pFeeModule.hwm64x64();
              const ownerShareAfter = await tokenS.balanceOf(manager.address);
              const pFeeAfter = ownerShareAfter.sub(ownerShareBefore);
              expect(hwmAfter).to.be.eq(hwmBefore);
              expect(pFeeAfter).to.be.lt(pFeeBefore);
              expect(pFeeAfter).to.be.eq(ether('0'));
            });
          });
        });
      });
    });
  });
});
