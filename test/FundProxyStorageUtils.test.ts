import { constants, Wallet, Signer } from 'ethers';
import { expect } from 'chai';
import { ethers, deployments } from 'hardhat';
import {
  ComptrollerImplementationMock,
  FundImplementation,
  AssetRouter,
  MortgageVault,
  FundFooAction,
  FundFoo,
  FundProxyMock,
  IERC20,
  AssetRegistry,
  Chainlink,
  SimpleToken,
  DSProxyRegistryMock,
  SetupAction,
} from '../typechain';
import { DS_PROXY_REGISTRY, DAI_TOKEN, DAI_PROVIDER, WL_ANY_SIG, FUND_STATE, FUND_PERCENTAGE_BASE } from './utils/constants';
import { impersonateAndInjectEther } from './utils/utils';

describe('FundProxyStorageUtils', function () {
  let comptroller: ComptrollerImplementationMock;
  let fundImplementation: FundImplementation;
  let assetRouter: AssetRouter;
  let mortgageVault: MortgageVault;
  let proxy: FundProxyMock;
  let setupAction: SetupAction;

  let owner: Wallet;
  let user: Wallet;
  let collector: Wallet;

  let foo: FundFoo;
  let fooAction: FundFooAction;

  let tokenA: IERC20;
  let tokenAProvider: Signer;

  let oracle: Chainlink;
  let registry: AssetRegistry;

  let tokenD: SimpleToken;
  let dsProxyRegistryMock: DSProxyRegistryMock;

  const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
    await deployments.fixture(''); // ensure you start from a fresh deployments
    [owner, user, collector] = await (ethers as any).getSigners();

    // setup token and unlock provider
    tokenAProvider = await impersonateAndInjectEther(DAI_PROVIDER);
    tokenA = await ethers.getContractAt('IERC20', DAI_TOKEN);

    fundImplementation = await (await ethers.getContractFactory('FundImplementation')).deploy(DS_PROXY_REGISTRY);
    await fundImplementation.deployed();

    registry = await (await ethers.getContractFactory('AssetRegistry')).deploy();
    await registry.deployed();

    oracle = await (await ethers.getContractFactory('Chainlink')).deploy();
    await oracle.deployed();

    assetRouter = await (await ethers.getContractFactory('AssetRouter')).deploy(oracle.address, registry.address);
    await assetRouter.deployed();

    mortgageVault = await (await ethers.getContractFactory('MortgageVault')).deploy(tokenA.address);
    await mortgageVault.deployed();

    comptroller = await (await ethers.getContractFactory('ComptrollerImplementationMock')).deploy();
    await comptroller.deployed();
    await comptroller.initialize(
      fundImplementation.address,
      assetRouter.address,
      collector.address,
      0,
      constants.AddressZero,
      constants.Zero,
      mortgageVault.address,
      0
    );

    foo = await (await ethers.getContractFactory('FundFoo')).deploy();
    await foo.deployed();
    fooAction = await (await ethers.getContractFactory('FundFooAction')).deploy();
    await fooAction.deployed();

    dsProxyRegistryMock = await (await ethers.getContractFactory('DSProxyRegistryMock')).deploy();
    await dsProxyRegistryMock.deployed();

    proxy = await (await ethers.getContractFactory('FundProxyMock')).connect(user).deploy(DS_PROXY_REGISTRY);
    await proxy.deployed();

    tokenD = await (await ethers.getContractFactory('SimpleToken')).connect(user).deploy();
    await tokenD.deployed();
    await comptroller.permitDenominations([tokenD.address], [0]);

    // Permit delegate calls
    comptroller.permitDelegateCalls(await proxy.level(), [fooAction.address], [WL_ANY_SIG]);
    comptroller.permitContractCalls(await proxy.level(), [foo.address], [WL_ANY_SIG]);

    setupAction = await (await ethers.getContractFactory('SetupAction')).deploy();
    await setupAction.deployed();
  });

  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.
  beforeEach(async function () {
    // setupTest will use the evm_snapshot to reset environment for speed up testing
    await setupTest();
  });

  describe('Fund proxy storage utils', function () {
    it('should revert: level is set', async function () {
      const level = 1;
      await proxy.setLevel(level);
      await expect(proxy.setLevel(level)).to.be.revertedWith('RevertCode(14)'); // FUND_PROXY_STORAGE_UTILS_LEVEL_IS_SET
    });

    it('should revert: zero level', async function () {
      await expect(proxy.setLevel(0)).to.be.revertedWith('RevertCode(15)'); // FUND_PROXY_STORAGE_UTILS_ZERO_LEVEL
    });

    it('should revert: comptroller is initialized', async function () {
      await proxy.setComptroller(comptroller.address);


      await expect(proxy.setComptroller(comptroller.address)).to.be.revertedWith(
        'RevertCode(16)'); // FUND_PROXY_STORAGE_UTILS_COMPTROLLER_IS_INITIALIZED

    });

    it('should revert: comptroller zero address', async function () {
      await expect(proxy.setComptroller(constants.AddressZero)).to.be.revertedWith(
        'RevertCode(17)'); // FUND_PROXY_STORAGE_UTILS_ZERO_COMPTROLLER_ADDRESS
    });

    it('should revert: share token is initialized', async function () {
      await proxy.setShareToken(tokenA.address);
      await expect(proxy.setShareToken(tokenA.address)).to.be.revertedWith(
        'RevertCode(19)'); // FUND_PROXY_STORAGE_UTILS_SHARE_TOKEN_IS_INITIALIZED
    });

    it('should revert: zero share token address', async function () {
      await expect(proxy.setShareToken(constants.AddressZero)).to.be.revertedWith(
        'RevertCode(20)'); // FUND_PROXY_STORAGE_UTILS_ZERO_SHARE_TOKEN_ADDRESS
    });

    it('should revert: mortgage vault is initialized', async function () {
      await proxy.setMortgageVault(comptroller.address);
      await expect(proxy.setMortgageVault(comptroller.address)).to.be.revertedWith(
        'RevertCode(21)'); // FUND_PROXY_STORAGE_UTILS_MORTGAGE_VAULT_IS_INITIALIZED
    });

    it('should revert: mortgage vault is not initialized', async function () {
      await comptroller.setMortgageVault(constants.AddressZero);
      await expect(proxy.setMortgageVault(comptroller.address)).to.be.revertedWith(
        'RevertCode(22)'); // FUND_PROXY_STORAGE_UTILS_MORTGAGE_VAULT_IS_NOT_INITIALIZED
    });

    it('should revert: vault is initialized', async function () {
      await proxy.setVault(DS_PROXY_REGISTRY);
      await expect(proxy.setVault(DS_PROXY_REGISTRY)).to.be.revertedWith(
        'RevertCode(23)'); // FUND_PROXY_STORAGE_UTILS_VAULT_IS_INITIALIZED
    });

    it('should revert: zero registry', async function () {
      await expect(proxy.setVault(constants.AddressZero)).to.be.revertedWith(
        'RevertCode(24)'); // FUND_PROXY_STORAGE_UTILS_ZERO_REGISTRY
    });

    it('should revert: vault is not initialized', async function () {
      await expect(proxy.setVault(dsProxyRegistryMock.address)).to.be.revertedWith(
        'RevertCode(25)'); // FUND_PROXY_STORAGE_UTILS_VAULT_IS_NOT_INITIALIZED
    });

    it('should revert: zero vault', async function () {
      await expect(proxy.setVaultApproval(setupAction.address)).to.be.revertedWith(
        'RevertCode(26)'); // FUND_PROXY_STORAGE_UTILS_ZERO_VAULT
    });

    it('should revert: zero setup action address', async function () {
      await proxy.setComptroller(comptroller.address);
      await proxy.setDenomination(tokenD.address);
      await proxy.setVault(DS_PROXY_REGISTRY);
      await expect(proxy.setVaultApproval(constants.AddressZero)).to.be.revertedWith(
        'RevertCode(27)'); // FUND_PROXY_STORAGE_UTILS_ZERO_SETUP_ACTION_ADDRESS
    });

    it('should revert: wrong allowance', async function () {
      await proxy.setComptroller(comptroller.address);
      await proxy.setDenomination(tokenD.address);
      await proxy.setVault(DS_PROXY_REGISTRY);
      const setupActionMock = await (await ethers.getContractFactory('SetupActionMock')).deploy();
      await setupActionMock.deployed();
      await expect(proxy.setVaultApproval(setupActionMock.address)).to.be.revertedWith(
        'RevertCode(28)'); // FUND_PROXY_STORAGE_UTILS_WRONG_ALLOWANCE
    });

    it('should revert: invalid denomination', async function () {
      await proxy.setComptroller(comptroller.address);
      await expect(proxy.setDenomination(tokenA.address)).to.be.revertedWith(
        'RevertCode(18)'); // FUND_PROXY_STORAGE_UTILS_INVALID_DENOMINATION
    });

    it('should revert: invalid reserve execution rate', async function () {
      proxy.setState(FUND_STATE.REVIEWING);
      await expect(proxy.setReserveExecutionRate(FUND_PERCENTAGE_BASE)).to.be.revertedWith(
        'RevertCode(76)'); // FUND_PROXY_STORAGE_UTILS_INVALID_RESERVE_EXECUTION_RATE
    });
  });
});