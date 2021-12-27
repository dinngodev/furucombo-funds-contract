import { constants, Wallet, BigNumber } from 'ethers';
import { expect } from 'chai';
import { ethers, deployments } from 'hardhat';
import { AssetModuleMock, SimpleToken } from '../typechain';
import { DS_PROXY_REGISTRY } from './utils/constants';

describe('Asset module', function () {
  let assetModule: AssetModuleMock;
  let user: Wallet;
  let tokenD: SimpleToken;
  let token0: SimpleToken;
  let token1: SimpleToken;
  let token2: SimpleToken;
  let vault: any;

  const assetAmount = ethers.utils.parseEther('1');

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }, options) => {
      await deployments.fixture();
      [user] = await (ethers as any).getSigners();
      assetModule = await (await ethers.getContractFactory('AssetModuleMock'))
        .connect(user)
        .deploy(DS_PROXY_REGISTRY);
      await assetModule.deployed();
      tokenD = await (await ethers.getContractFactory('SimpleToken'))
        .connect(user)
        .deploy();
      await tokenD.deployed();
      token0 = await (await ethers.getContractFactory('SimpleToken'))
        .connect(user)
        .deploy();
      await tokenD.deployed();
      token1 = await (await ethers.getContractFactory('SimpleToken'))
        .connect(user)
        .deploy();
      await tokenD.deployed();
      token2 = await (await ethers.getContractFactory('SimpleToken'))
        .connect(user)
        .deploy();
      await tokenD.deployed();
      // initialize
      await assetModule.setDenomination(tokenD.address);
      await assetModule.setShare();
      await assetModule.setDSProxy();
      vault = await assetModule.callStatic.vault();
    }
  );

  beforeEach(async function () {
    await setupTest();
    await tokenD.approve(assetModule.address, constants.MaxUint256);
  });

  describe('add asset', function () {
    it('should success when asset is not in the list', async function () {
      await expect(assetModule.addAsset(token0.address))
        .to.emit(assetModule, 'AssetAdded')
        .withArgs(token0.address);
    });

    it('should fail when asset is in the list', async function () {
      await assetModule.addAsset(token0.address);
      await expect(assetModule.addAsset(token0.address)).to.be.revertedWith(
        'Asset existed'
      );
    });
  });

  describe('remove asset', function () {
    it('should success when asset is in the list', async function () {
      await assetModule.addAsset(token0.address);
      await expect(assetModule.removeAsset(token0.address))
        .to.emit(assetModule, 'AssetRemoved')
        .withArgs(token0.address);
    });

    it('should fail when asset is in the list', async function () {
      await expect(assetModule.removeAsset(token0.address)).to.be.revertedWith(
        'Asset not existed'
      );
    });
  });

  describe('close', function () {
    describe('when executing', function () {
      beforeEach(async function () {
        await assetModule.setState(2);
      });

      it('should success when denomination asset is the only asset', async function () {
        await assetModule.addAsset(tokenD.address);
        await expect(assetModule.close())
          .to.emit(assetModule, 'StateTransited')
          .withArgs(5);
      });

      it('should fail when denomination asset is not the only asset', async function () {
        await assetModule.addAsset(tokenD.address);
        await assetModule.addAsset(token0.address);
        await expect(assetModule.close()).to.be.reverted;
      });

      it('should fail when denomination asset is not in the asset list', async function () {
        await assetModule.addAsset(token0.address);
        await expect(assetModule.close()).to.be.reverted;
      });
    });

    describe('when liquidating', function () {
      beforeEach(async function () {
        await assetModule.setState(4);
      });

      it('should success when denomination asset is the only asset', async function () {
        await assetModule.addAsset(tokenD.address);
        await expect(assetModule.close())
          .to.emit(assetModule, 'StateTransited')
          .withArgs(5);
      });

      it('should fail when denomination asset is not the only asset', async function () {
        await assetModule.addAsset(tokenD.address);
        await assetModule.addAsset(token0.address);
        await expect(assetModule.close()).to.be.reverted;
      });

      it('should fail when denomination asset is not in the asset list', async function () {
        await assetModule.addAsset(token0.address);
        await expect(assetModule.close()).to.be.reverted;
      });
    });

    it('should fail when not Executing or Liquidating', async function () {
      await assetModule.addAsset(tokenD.address);
      await expect(assetModule.close()).to.be.revertedWith('InvalidState(0)');
    });
  });

  describe('get asset list', function () {
    beforeEach(async function () {
      await assetModule.addAsset(tokenD.address);
      await assetModule.addAsset(token0.address);
      await assetModule.addAsset(token1.address);
    });

    it('should show the added assets', async function () {
      await assetModule.addAsset(token2.address);
      const assetList = [
        tokenD.address,
        token0.address,
        token1.address,
        token2.address,
      ];
      expect(await assetModule.callStatic.getAssetList()).to.be.deep.eq(
        assetList
      );
    });

    it('should not show the removed asset', async function () {
      await assetModule.removeAsset(token1.address);
      const assetList = [tokenD.address, token0.address];
      expect(await assetModule.callStatic.getAssetList()).to.be.deep.eq(
        assetList
      );
    });
  });

  it('get reserve', async function () {
    await tokenD.transfer(vault, assetAmount);
    expect(await assetModule.callStatic.getReserve()).to.be.eq(assetAmount);
  });
});