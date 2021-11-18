import { Wallet, BigNumber, Signer } from 'ethers';
import { expect } from 'chai';
import { ethers, deployments } from 'hardhat';
import {
  Comptroller,
  Implementation,
  AssetRouter,
  TaskExecutorMock,
  IDSProxyRegistry,
  IERC20,
  AFurucombo,
  FurucomboProxy,
  Registry,
  HFunds,
  PoolProxyMock,
} from '../typechain';

import {
  DS_PROXY_REGISTRY,
  DAI_TOKEN,
  DAI_PROVIDER,
  WETH_TOKEN,
  WL_ANY_SIG,
  NATIVE_TOKEN,
  FURUCOMBO_HQUICKSWAP,
  WMATIC_TOKEN,
} from './utils/constants';
import {
  getActionReturn,
  getCallData,
  ether,
  impersonateAndInjectEther,
  simpleEncode,
  stringToHex,
  getTaskExecutorFundQuotas,
  getTaskExecutorDealingAssets,
  profileGas,
} from './utils/utils';

describe('AFurucombo', function () {
  let comptroller: Comptroller;
  let implementation: Implementation;
  let assetRouter: AssetRouter;
  let taskExecutor: TaskExecutorMock;
  let dsProxyRegistry: IDSProxyRegistry;
  let proxy: PoolProxyMock;

  let owner: Wallet;
  let user: Wallet;
  let collector: Wallet;

  let furucombo: FurucomboProxy;
  let aFurucombo: AFurucombo;
  let furuRegistry: Registry;
  let hFunds: HFunds;

  let token: IERC20;
  let tokenOut: IERC20;
  let tokenProvider: Signer;

  const setupTest = deployments.createFixture(
    async ({ deployments, ethers }, options) => {
      await deployments.fixture(); // ensure you start from a fresh deployments
      [owner, user, collector] = await (ethers as any).getSigners();

      // Setup token and unlock provider
      tokenProvider = await impersonateAndInjectEther(DAI_PROVIDER);
      token = await ethers.getContractAt('IERC20', DAI_TOKEN);
      tokenOut = await ethers.getContractAt('IERC20', WETH_TOKEN);

      // Setup contracts
      implementation = await (
        await ethers.getContractFactory('Implementation')
      ).deploy(DS_PROXY_REGISTRY, 'PoolToken', 'PCT');
      await implementation.deployed();

      assetRouter = await (
        await ethers.getContractFactory('AssetRouter')
      ).deploy();
      await assetRouter.deployed();

      comptroller = await (
        await ethers.getContractFactory('Comptroller')
      ).deploy(implementation.address, assetRouter.address, collector.address);
      await comptroller.deployed();
      await comptroller.setInitialAssetCheck(false);

      taskExecutor = await (
        await ethers.getContractFactory('TaskExecutorMock')
      ).deploy(owner.address, comptroller.address);
      await taskExecutor.deployed();
      await comptroller.setExecAction(taskExecutor.address);

      // Setup furucombo and AFurucombo
      furuRegistry = await (
        await ethers.getContractFactory('Registry')
      ).deploy();
      await furuRegistry.deployed();

      furucombo = await (
        await ethers.getContractFactory('FurucomboProxy')
      ).deploy(furuRegistry.address);
      await furucombo.deployed();

      aFurucombo = await (
        await ethers.getContractFactory('AFurucombo')
      ).deploy(owner.address, furucombo.address);
      await aFurucombo.deployed();

      hFunds = await (await ethers.getContractFactory('HFunds')).deploy();
      await hFunds.deployed();

      await furuRegistry.register(
        hFunds.address,
        ethers.utils.hexZeroPad(stringToHex('HFunds'), 32)
      );

      await furuRegistry.register(
        FURUCOMBO_HQUICKSWAP,
        ethers.utils.hexZeroPad(stringToHex('FURUCOMBO_HQUICKSWAP'), 32)
      );

      // Setup PoolProxy
      dsProxyRegistry = await ethers.getContractAt(
        'IDSProxyRegistry',
        DS_PROXY_REGISTRY
      );

      proxy = await (await ethers.getContractFactory('PoolProxyMock'))
        .connect(user)
        .deploy(dsProxyRegistry.address, 'PoolProxyMock', 'PMT');
      await proxy.deployed();

      // Permit delegate calls
      comptroller.permitDelegateCalls(
        await proxy.getLevel(),
        [aFurucombo.address],
        [WL_ANY_SIG]
      );

      // Permit handler
      comptroller.permitHandlers(
        await proxy.getLevel(),
        [hFunds.address],
        [WL_ANY_SIG]
      );

      comptroller.permitHandlers(
        await proxy.getLevel(),
        [FURUCOMBO_HQUICKSWAP],
        [WL_ANY_SIG]
      );
    }
  );

  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.
  // setupTest will use the evm_snapshot to reset environment to speed up testing
  beforeEach(async function () {
    await setupTest();
  });

  describe('inject and batchExec', function () {
    const furucomboTokenDust = BigNumber.from('10');
    it('swap native and token to token', async function () {
      const tokensIn = [NATIVE_TOKEN, token.address];
      const amountsIn = [ether('2'), ether('1')];
      const tokensOut = [tokenOut.address];
      const tos = [hFunds.address, FURUCOMBO_HQUICKSWAP, FURUCOMBO_HQUICKSWAP];
      const configs = [
        '0x0004000000000000000000000000000000000000000000000000000000000000', // return size = 4 (uint256[2])
        '0x0100000000000000000102ffffffffffffffffffffffffffffffffffffffffff', // ref location = stack[2]
        '0x0100000000000000000103ffffffffffffffffffffffffffffffffffffffffff', // ref location = stack[3]
      ];

      const datas = [
        simpleEncode('updateTokens(address[])', [tokensIn]),
        simpleEncode('swapExactETHForTokens(uint256,uint256,address[])', [
          0, // amountIn: 100% return data
          1, // amountOutMin
          [WMATIC_TOKEN, tokenOut.address], // path
        ]),
        simpleEncode('swapExactTokensForTokens(uint256,uint256,address[])', [
          0, // amountIn: 100% return data
          1, // amountOutMin
          [token.address, tokenOut.address], // path
        ]),
      ];

      // TaskExecutorMock data
      const data = getCallData(taskExecutor, 'execMock', [
        tokensIn,
        amountsIn,
        aFurucombo.address,
        getCallData(aFurucombo, 'injectAndBatchExec', [
          tokensIn,
          amountsIn,
          tokensOut,
          tos,
          configs,
          datas,
        ]),
      ]);

      // send token to vault
      const vault = await proxy.vault();
      await token.connect(tokenProvider).transfer(vault, amountsIn[1]);

      // Execute
      const receipt = await proxy
        .connect(user)
        .execute(taskExecutor.address, data, {
          value: amountsIn[0],
        });

      // Record after balance
      const balanceAfter = await ethers.provider.getBalance(vault);
      const tokenAfter = await token.balanceOf(vault);
      const tokenOutAfter = await tokenOut.balanceOf(vault);
      const tokenFurucomboAfter = await token.balanceOf(furucombo.address);

      // Get fundQuotas and dealing asset
      const fundQuotas = await getTaskExecutorFundQuotas(
        proxy,
        taskExecutor,
        tokensIn
      );
      const outputFundQuotas = await getTaskExecutorFundQuotas(
        proxy,
        taskExecutor,
        tokensOut
      );
      const dealingAssets = await getTaskExecutorDealingAssets(
        proxy,
        taskExecutor
      );

      // Verify action return
      const actionReturn = await getActionReturn(receipt, ['uint256[]']);
      expect(actionReturn[0]).to.be.eq(tokenOutAfter);

      // Verify user dsproxy
      expect(balanceAfter).to.be.eq(0);
      expect(tokenAfter).to.be.eq(0);
      expect(tokenOutAfter).to.be.gt(0);

      // Verify furucombo proxy
      expect(tokenFurucomboAfter).to.be.lt(furucomboTokenDust);

      // Verify fund Quota
      for (let i = 0; i < fundQuotas.length; i++) {
        expect(fundQuotas[i]).to.be.lt(tokensIn[i]);
      }
      const tokenOutAfters = [tokenOutAfter];
      for (let i = 0; i < outputFundQuotas.length; i++) {
        expect(outputFundQuotas[i]).to.be.eq(tokenOutAfters[i]);
      }

      // Verify dealing asset
      for (let i = 0; i < dealingAssets.length; i++) {
        expect(dealingAssets[i]).to.be.eq(tokensOut[i]);
      }

      await profileGas(receipt);
    });

    it('swap token to native and token', async function () {
      const tokensIn = [token.address];
      const amountsIn = [ether('1')];
      const tokensOut = [NATIVE_TOKEN, tokenOut.address];
      const tos = [hFunds.address, FURUCOMBO_HQUICKSWAP, FURUCOMBO_HQUICKSWAP];
      const configs = [
        '0x0003000000000000000000000000000000000000000000000000000000000000', // return size = 3 (uint256[1])
        '0x0100000000000000000102ffffffffffffffffffffffffffffffffffffffffff', // ref location = stack[2]
        '0x0100000000000000000102ffffffffffffffffffffffffffffffffffffffffff', // ref location = stack[2]
      ];
      const datas = [
        simpleEncode('updateTokens(address[])', [tokensIn]),
        simpleEncode('swapExactTokensForETH(uint256,uint256,address[])', [
          ether('0.5'), // amountIn: 50% return data
          1, // amountOutMin
          [token.address, WMATIC_TOKEN], // path
        ]),
        simpleEncode('swapExactTokensForTokens(uint256,uint256,address[])', [
          ether('0.5'), // amountIn: 50% return data
          1, // amountOutMin
          [token.address, tokenOut.address], // path
        ]),
      ];

      // TaskExecutorMock data
      const data = getCallData(taskExecutor, 'execMock', [
        tokensIn,
        amountsIn,
        aFurucombo.address,
        getCallData(aFurucombo, 'injectAndBatchExec', [
          tokensIn,
          amountsIn,
          tokensOut,
          tos,
          configs,
          datas,
        ]),
      ]);

      // Send token to vault
      const vault = await proxy.vault();
      await token.connect(tokenProvider).transfer(vault, amountsIn[0]);

      // Execute
      const receipt = await proxy
        .connect(user)
        .execute(taskExecutor.address, data);

      // Get fundQuotas and dealing asset
      const fundQuotas = await getTaskExecutorFundQuotas(
        proxy,
        taskExecutor,
        tokensIn
      );
      const outputFundQuotas = await getTaskExecutorFundQuotas(
        proxy,
        taskExecutor,
        tokensOut
      );
      const dealingAssets = await getTaskExecutorDealingAssets(
        proxy,
        taskExecutor
      );

      // Record after balance
      const balanceAfter = await ethers.provider.getBalance(vault);
      const tokenAfter = await token.balanceOf(vault);
      const tokenOutAfter = await tokenOut.balanceOf(vault);
      const tokenFurucomboAfter = await token.balanceOf(furucombo.address);

      // Check action return
      const actionReturn = await getActionReturn(receipt, ['uint256[]']);
      expect(actionReturn[0]).to.be.eq(balanceAfter);
      expect(actionReturn[1]).to.be.eq(tokenOutAfter);

      // Check user dsproxy
      expect(balanceAfter).to.be.gt(ether('0'));
      expect(tokenAfter).to.be.eq(ether('0'));
      expect(tokenOutAfter).to.be.gt(ether('0'));

      // Verify furucombo proxy
      expect(tokenFurucomboAfter).to.be.lt(furucomboTokenDust);

      // Verify fund Quota
      for (let i = 0; i < fundQuotas.length; i++) {
        expect(fundQuotas[i]).to.be.lt(tokensIn[i]);
      }
      const tokenOutAfters = [balanceAfter, tokenOutAfter];
      for (let i = 0; i < outputFundQuotas.length; i++) {
        expect(outputFundQuotas[i]).to.be.eq(tokenOutAfters[i]);
      }

      // Verify dealing asset
      for (let i = 0; i < dealingAssets.length; i++) {
        // Furucombo would not return Native token as dealing assets
        // It will be fine because native tokens always be approved as dealing asset
        if (tokensOut[i] === NATIVE_TOKEN) continue;
        expect(dealingAssets[i]).to.be.eq(tokensOut[i]);
      }

      await profileGas(receipt);
    });

    it('remaining tokens < token dust', async function () {
      const amountIn = furucomboTokenDust.sub(BigNumber.from('1'));
      const tokensIn = [token.address];
      const amountsIn = [amountIn];

      // TaskExecutorMock data
      const data = getCallData(taskExecutor, 'execMock', [
        tokensIn,
        amountsIn,
        aFurucombo.address,
        getCallData(aFurucombo, 'injectAndBatchExec', [
          tokensIn,
          amountsIn,
          [],
          [],
          [],
          [],
        ]),
      ]);

      // send token to vault
      const vault = await proxy.vault();
      await token.connect(tokenProvider).transfer(vault, amountsIn[0]);

      // Execute
      await proxy.connect(user).execute(taskExecutor.address, data);

      const tokenFurucomboAfter = await token.balanceOf(furucombo.address);
      // Verify furucombo proxy
      expect(tokenFurucomboAfter).to.be.eq(amountIn);
    });

    it('should revert: inconsistent length', async function () {
      const tokensIn = [token.address];
      const amountsIn = [ether('1'), ether('1')];

      // TaskExecutorMock data
      const data = getCallData(taskExecutor, 'execMock', [
        tokensIn,
        amountsIn,
        aFurucombo.address,
        getCallData(aFurucombo, 'injectAndBatchExec', [
          tokensIn,
          amountsIn,
          [],
          [],
          [],
          [],
        ]),
      ]);

      // send token to vault
      const vault = await proxy.vault();
      await token.connect(tokenProvider).transfer(vault, amountsIn[0]);

      await expect(
        proxy.connect(user).execute(taskExecutor.address, data)
      ).to.be.revertedWith(
        '_inject: Input tokens and amounts length inconsistent'
      );
    });

    it('should revert: remaining tokens >= token dust', async function () {
      const tokensIn = [token.address];
      const amountsIn = [furucomboTokenDust];

      // TaskExecutorMock data
      const data = getCallData(taskExecutor, 'execMock', [
        tokensIn,
        amountsIn,
        aFurucombo.address,
        getCallData(aFurucombo, 'injectAndBatchExec', [
          tokensIn,
          amountsIn,
          [],
          [],
          [],
          [],
        ]),
      ]);

      // send token to vault
      const vault = await proxy.vault();
      await token.connect(tokenProvider).transfer(vault, amountsIn[0]);

      await expect(
        proxy.connect(user).execute(taskExecutor.address, data)
      ).to.be.revertedWith(
        'injectAndBatchExec: Furucombo has remaining tokens'
      );
    });
  });
});
