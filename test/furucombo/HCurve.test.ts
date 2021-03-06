import { constants, Wallet, BigNumber, Signer } from 'ethers';
import { expect } from 'chai';
import { ethers, deployments } from 'hardhat';
import { FurucomboProxyMock, FurucomboRegistry, IERC20, ICurveHandler, HCurve } from '../../typechain';

import {
  DAI_TOKEN,
  USDT_TOKEN,
  WBTC_TOKEN,
  WETH_TOKEN,
  RENBTC_TOKEN,
  RENBTC_PROVIDER,
  EURT_TOKEN,
  CURVE_AAVE_SWAP,
  CURVE_AAVECRV,
  CURVE_REN_SWAP,
  CURVE_RENCRV,
  CURVE_RENCRV_PROVIDER,
  CURVE_ATRICRYPTO3_DEPOSIT,
  CURVE_EURTUSD_DEPOSIT,
  MATIC_TOKEN,
  NATIVE_TOKEN,
} from '../utils/constants';

import {
  ether,
  mulPercent,
  asciiToHex32,
  getHandlerReturn,
  tokenProviderQuick,
  getCallData,
  tokenProviderCurveGauge,
  impersonateAndInjectEther,
  expectEqWithinBps,
} from '../utils/utils';

describe('HCurve', function () {
  let owner: Wallet;
  let user: Wallet;
  let aaveSwap: ICurveHandler;
  let renSwap: ICurveHandler;
  let atricrypto3Swap: ICurveHandler;
  let eurtusdSwap: ICurveHandler;
  let hCurve: HCurve;
  let proxy: FurucomboProxyMock;
  let registry: FurucomboRegistry;
  const slippage = BigNumber.from('3');
  const setupTest = deployments.createFixture(async ({ deployments, ethers }, options) => {
    await deployments.fixture(''); // ensure you start from a fresh deployments
    [owner, user] = await (ethers as any).getSigners();

    aaveSwap = await ethers.getContractAt('ICurveHandler', CURVE_AAVE_SWAP);
    renSwap = await ethers.getContractAt('ICurveHandler', CURVE_REN_SWAP);
    atricrypto3Swap = await ethers.getContractAt('ICurveHandler', CURVE_ATRICRYPTO3_DEPOSIT);
    eurtusdSwap = await ethers.getContractAt('ICurveHandler', CURVE_EURTUSD_DEPOSIT);

    // Setup proxy and Aproxy
    registry = await (await ethers.getContractFactory('FurucomboRegistry')).deploy();
    await registry.deployed();

    proxy = await (await ethers.getContractFactory('FurucomboProxyMock')).deploy(registry.address);
    await proxy.deployed();

    hCurve = await (await ethers.getContractFactory('HCurve')).deploy();
    await hCurve.deployed();
    await registry.register(hCurve.address, asciiToHex32('HCurve'));

    // register HCurve callee
    await registry.registerHandlerCalleeWhitelist(hCurve.address, aaveSwap.address);
    await registry.registerHandlerCalleeWhitelist(hCurve.address, renSwap.address);
    await registry.registerHandlerCalleeWhitelist(hCurve.address, atricrypto3Swap.address);
    await registry.registerHandlerCalleeWhitelist(hCurve.address, eurtusdSwap.address);
  });

  beforeEach(async function () {
    await setupTest();
  });

  describe('Exchange underlying', function () {
    let token0User: BigNumber;
    let token1User: BigNumber;
    let providerAddress: any;
    let token0: IERC20, token1: IERC20;
    let answer: BigNumber;

    describe('aave pool', function () {
      const token0Address = USDT_TOKEN;
      const token1Address = DAI_TOKEN;
      const value = BigNumber.from('1000000');

      beforeEach(async function () {
        providerAddress = await tokenProviderQuick(token0Address);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        answer = await aaveSwap['get_dy_underlying(int128,int128,uint256)'](2, 0, value);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);
        await token0.connect(providerAddress).transfer(proxy.address, value);
        await proxy.updateTokenMock(token0.address);
      });
      it('Exact input swap USDT to DAI by exchangeUnderlying', async function () {
        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          aaveSwap.address,
          token0.address,
          token1.address,
          2,
          0,
          value,
          mulPercent(answer, BigNumber.from('100').sub(slippage)),
        ]);

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));

        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });

      it('Exact input swap USDT to DAI by exchangeUnderlying with max amount', async function () {
        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          aaveSwap.address,
          token0.address,
          token1.address,
          2,
          0,
          constants.MaxUint256,
          mulPercent(answer, BigNumber.from('100').sub(slippage)),
        ]);

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));

        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });

      it('should revert: not support MRC20', async function () {
        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          aaveSwap.address,
          MATIC_TOKEN,
          token1.address,
          2,
          0,
          value,
          0,
        ]);

        await expect(
          proxy.connect(user).execMock(hCurve.address, data, {
            value: value,
          })
        ).revertedWith('Not support matic token');
      });

      it('should revert: invalid callee when exchangeUnderlying', async function () {
        // Unregister callee
        await registry.unregisterHandlerCalleeWhitelist(hCurve.address, aaveSwap.address);

        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          aaveSwap.address,
          MATIC_TOKEN,
          token1.address,
          2,
          0,
          value,
          0,
        ]);

        await expect(
          proxy.connect(user).execMock(hCurve.address, data, {
            value: value,
          })
        ).revertedWith('HCurve_exchangeUnderlying: invalid callee');
      });

      it('should revert: input token not support native token', async function () {
        const inputAmount = ether('5');
        const answer = await aaveSwap['get_dy_underlying(int128,int128,uint256)'](2, 0, inputAmount);

        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          aaveSwap.address,
          NATIVE_TOKEN,
          token0.address,
          2,
          0,
          inputAmount,
          mulPercent(answer, BigNumber.from('100').sub(slippage)),
        ]);

        await expect(
          proxy.connect(user).execMock(hCurve.address, data, {
            value: 0,
          })
        ).to.be.revertedWith('_exec');
      });
    });

    describe('ren pool', function () {
      const token0Address = WBTC_TOKEN;
      const token1Address = RENBTC_TOKEN;
      const value = BigNumber.from('100000000');

      beforeEach(async function () {
        providerAddress = await tokenProviderQuick(token0Address);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        answer = await renSwap['get_dy_underlying(int128,int128,uint256)'](0, 1, value);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);

        await token0.connect(providerAddress).transfer(proxy.address, value);
        await proxy.updateTokenMock(token0.address);
      });

      it('Exact input swap WBTC to renBTC by exchangeUnderlying', async function () {
        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          renSwap.address,
          token0.address,
          token1.address,
          0,
          1,
          value,
          mulPercent(answer, BigNumber.from('100').sub(slippage)),
        ]);
        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });
        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));
        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });

      it('Exact input swap WBTC to renBTC by exchangeUnderlying with max amount', async function () {
        const data = getCallData(hCurve, 'exchangeUnderlying(address,address,address,int128,int128,uint256,uint256)', [
          renSwap.address,
          token0.address,
          token1.address,
          0,
          1,
          constants.MaxUint256,
          mulPercent(answer, BigNumber.from('100').sub(slippage)),
        ]);

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));

        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });
    });

    describe('atricrypto3 pool', function () {
      const token0Address = WETH_TOKEN;
      const token1Address = DAI_TOKEN;
      const value = BigNumber.from('10000000000000000000');

      beforeEach(async function () {
        providerAddress = await tokenProviderQuick(token0Address);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        answer = await atricrypto3Swap['get_dy_underlying(uint256,uint256,uint256)'](4, 0, value);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);

        await token0.connect(providerAddress).transfer(proxy.address, value);
        await proxy.updateTokenMock(token0.address);
      });

      it('Exact input swap WETH to DAI by exchangeUnderlyingUint256', async function () {
        const data = getCallData(
          hCurve,
          'exchangeUnderlyingUint256(address,address,address,uint256,uint256,uint256,uint256)',
          [
            atricrypto3Swap.address,
            token0.address,
            token1.address,
            4,
            0,
            value,
            mulPercent(answer, BigNumber.from('100').sub(slippage)),
          ]
        );
        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });
        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));
        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });

      it('Exact input swap WETH to DAI by exchangeUnderlying with max amount', async function () {
        const data = getCallData(
          hCurve,
          'exchangeUnderlyingUint256(address,address,address,uint256,uint256,uint256,uint256)',
          [
            atricrypto3Swap.address,
            token0.address,
            token1.address,
            4,
            0,
            constants.MaxUint256,
            mulPercent(answer, BigNumber.from('100').sub(slippage)),
          ]
        );

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));

        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });
    });

    describe('eurtusd pool', function () {
      const token0Address = DAI_TOKEN;
      const token1Address = EURT_TOKEN;
      const value = BigNumber.from('1000000000000000000');

      beforeEach(async function () {
        providerAddress = await tokenProviderQuick(token0Address);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        answer = await eurtusdSwap['get_dy_underlying(uint256,uint256,uint256)'](1, 0, value);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);

        await token0.connect(providerAddress).transfer(proxy.address, value);
        await proxy.updateTokenMock(token0.address);
      });

      it('Exact input swap DAI to EURT by exchangeUnderlyingUint256', async function () {
        const data = getCallData(
          hCurve,
          'exchangeUnderlyingUint256(address,address,address,uint256,uint256,uint256,uint256)',
          [
            eurtusdSwap.address,
            token0.address,
            token1.address,
            1,
            0,
            value,
            mulPercent(answer, BigNumber.from('100').sub(slippage)),
          ]
        );
        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });
        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));
        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });

      it('Exact input swap DAI to EURT by exchangeUnderlying with max amount', async function () {
        const data = getCallData(
          hCurve,
          'exchangeUnderlyingUint256(address,address,address,uint256,uint256,uint256,uint256)',
          [
            eurtusdSwap.address,
            token0.address,
            token1.address,
            1,
            0,
            constants.MaxUint256,
            mulPercent(answer, BigNumber.from('100').sub(slippage)),
          ]
        );

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'), // Ensure handler can correctly deal with ether
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1User));

        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);

        // Check user's token balance to within 1%
        expectEqWithinBps(token1UserEnd, token1User.add(answer), 10);
      });
    });
  });

  describe('Liquidity Underlying', function () {
    describe('aave pool', function () {
      const token0Address = DAI_TOKEN;
      const token1Address = USDT_TOKEN;
      const poolTokenAddress = CURVE_AAVECRV;

      let token0User: BigNumber, token1User: BigNumber, poolTokenUser: BigNumber;
      let provider0Address: string, provider1Address: string;
      let poolTokenProvider: Signer;
      let token0: IERC20, token1: IERC20, poolToken: IERC20;

      beforeEach(async function () {
        provider0Address = await tokenProviderQuick(token0Address);
        provider1Address = await tokenProviderQuick(token1Address);
        poolTokenProvider = await tokenProviderCurveGauge(poolTokenAddress);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        poolToken = await ethers.getContractAt('IERC20', poolTokenAddress);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);
        poolTokenUser = await poolToken.balanceOf(user.address);
      });

      it('add DAI and USDT to pool by addLiquidityUnderlying', async function () {
        const token0Amount = ether('1');
        const token1Amount = BigNumber.from('2000000');
        const tokens = [token0.address, constants.AddressZero, token1.address];
        const amounts: [BigNumber, BigNumber, BigNumber] = [token0Amount, BigNumber.from('0'), token1Amount];
        // Get expected answer
        const answer = await aaveSwap['calc_token_amount(uint256[3],bool)'](amounts, true);

        // Execute handler
        await token0.connect(provider0Address).transfer(proxy.address, token0Amount);
        await token1.connect(provider1Address).transfer(proxy.address, token1Amount);

        await proxy.updateTokenMock(token0.address);
        await proxy.updateTokenMock(token1.address);
        const minMintAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(hCurve, 'addLiquidityUnderlying(address,address,address[],uint256[],uint256)', [
          aaveSwap.address,
          poolToken.address,
          tokens,
          amounts,
          minMintAmount,
        ]);
        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'),
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];

        const poolTokenUserEnd = await poolToken.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(poolTokenUserEnd.sub(poolTokenUser));

        // Check proxy balance
        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await poolToken.balanceOf(proxy.address)).to.be.eq(0);

        // Check user balance
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);
        expect(await token1.balanceOf(user.address)).to.be.eq(token1User);

        // Check pool token balance
        expectEqWithinBps(poolTokenUserEnd, poolTokenUser.add(answer), 10);
      });

      it('remove from pool to USDT by removeLiquidityOneCoinUnderlying', async function () {
        const poolTokenUser = ether('0.1');
        const token1UserBefore = await token1.balanceOf(user.address);
        const answer = await aaveSwap['calc_withdraw_one_coin(uint256,int128)'](poolTokenUser, 2);

        await poolToken.connect(poolTokenProvider).transfer(proxy.address, poolTokenUser);

        await proxy.updateTokenMock(poolToken.address);

        const minAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(
          hCurve,
          'removeLiquidityOneCoinUnderlying(address,address,address,uint256,int128,uint256)',
          [aaveSwap.address, poolToken.address, token1.address, poolTokenUser, 2, minAmount]
        );

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'),
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1UserBefore));

        // Check proxy balance
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await poolToken.balanceOf(proxy.address)).to.be.eq(0);

        // Check user
        expect(token1UserEnd).to.be.eq(token1UserBefore.add(answer));
      });

      it('should revert: invalid callee when addLiquidityUnderlying', async function () {
        // Unregister callee
        await registry.unregisterHandlerCalleeWhitelist(hCurve.address, aaveSwap.address);

        const token0Amount = ether('1');
        const token1Amount = BigNumber.from('2000000');
        const tokens = [token0.address, constants.AddressZero, token1.address];
        const amounts: [BigNumber, BigNumber, BigNumber] = [token0Amount, BigNumber.from('0'), token1Amount];
        // Get expected answer
        const answer = await aaveSwap['calc_token_amount(uint256[3],bool)'](amounts, true);

        // Execute handler
        await token0.connect(provider0Address).transfer(proxy.address, token0Amount);
        await token1.connect(provider1Address).transfer(proxy.address, token1Amount);

        await proxy.updateTokenMock(token0.address);
        await proxy.updateTokenMock(token1.address);
        const minMintAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(hCurve, 'addLiquidityUnderlying(address,address,address[],uint256[],uint256)', [
          aaveSwap.address,
          poolToken.address,
          tokens,
          amounts,
          minMintAmount,
        ]);

        await expect(
          proxy.connect(user).execMock(hCurve.address, data, {
            value: ether('1'),
          })
        ).revertedWith('HCurve_addLiquidityUnderlying: invalid callee');
      });

      it('should revert: invalid callee when removeLiquidityOneCoinUnderlying', async function () {
        // Unregister callee
        await registry.unregisterHandlerCalleeWhitelist(hCurve.address, aaveSwap.address);

        const poolTokenUser = ether('0.1');
        const token1UserBefore = await token1.balanceOf(user.address);
        const answer = await aaveSwap['calc_withdraw_one_coin(uint256,int128)'](poolTokenUser, 2);

        await poolToken.connect(poolTokenProvider).transfer(proxy.address, poolTokenUser);

        await proxy.updateTokenMock(poolToken.address);

        const minAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(
          hCurve,
          'removeLiquidityOneCoinUnderlying(address,address,address,uint256,int128,uint256)',
          [aaveSwap.address, poolToken.address, token1.address, poolTokenUser, 2, minAmount]
        );

        await expect(
          proxy.connect(user).execMock(hCurve.address, data, {
            value: ether('1'),
          })
        ).revertedWith('HCurve_removeLiquidityOneCoinUnderlying: invalid callee');
      });
    });

    describe('ren pool', function () {
      const token0Address = WBTC_TOKEN;
      const token1Address = RENBTC_TOKEN;
      const token1ProviderAddress = RENBTC_PROVIDER;
      const poolTokenAddress = CURVE_RENCRV;
      const poolTokenProviderAddress = CURVE_RENCRV_PROVIDER;

      let token0User: BigNumber, token1User: BigNumber, poolTokenUser: BigNumber;
      let provider0Address: string, provider1Address: string;
      let poolTokenProvider: Signer;
      let token0: IERC20, token1: IERC20, poolToken: IERC20;

      beforeEach(async function () {
        provider0Address = await tokenProviderQuick(token0Address);
        provider1Address = await impersonateAndInjectEther(token1ProviderAddress);
        poolTokenProvider = await impersonateAndInjectEther(poolTokenProviderAddress);
        token0 = await ethers.getContractAt('IERC20', token0Address);
        token1 = await ethers.getContractAt('IERC20', token1Address);
        poolToken = await ethers.getContractAt('IERC20', poolTokenAddress);
        token0User = await token0.balanceOf(user.address);
        token1User = await token1.balanceOf(user.address);
        poolTokenUser = await poolToken.balanceOf(user.address);
      });

      it('add WBTC and RENBTC to pool by addLiquidityUnderlying', async function () {
        const token0Amount = BigNumber.from('100000000');
        const token1Amount = BigNumber.from('100000000');
        const tokens = [token0.address, token1.address];
        const amounts: [BigNumber, BigNumber] = [token0Amount, token1Amount];
        // Get expected answer
        const answer = await renSwap['calc_token_amount(uint256[2],bool)'](amounts, true);

        // Execute handler
        await token0.connect(provider0Address).transfer(proxy.address, token0Amount);
        await token1.connect(provider1Address).transfer(proxy.address, token1Amount);

        await proxy.updateTokenMock(token0.address);
        await proxy.updateTokenMock(token1.address);
        const minMintAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(hCurve, 'addLiquidityUnderlying(address,address,address[],uint256[],uint256)', [
          renSwap.address,
          poolToken.address,
          tokens,
          amounts,
          minMintAmount,
        ]);
        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'),
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];

        const poolTokenUserEnd = await poolToken.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(poolTokenUserEnd.sub(poolTokenUser));

        // Check proxy balance
        expect(await token0.balanceOf(proxy.address)).to.be.eq(0);
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await poolToken.balanceOf(proxy.address)).to.be.eq(0);

        // Check user balance
        expect(await token0.balanceOf(user.address)).to.be.eq(token0User);
        expect(await token1.balanceOf(user.address)).to.be.eq(token1User);

        // Check pool token balance
        expectEqWithinBps(poolTokenUserEnd, poolTokenUser.add(answer), 10);
      });

      it('remove from pool to RENBTC by removeLiquidityOneCoinUnderlying', async function () {
        const poolTokenUser = ether('0.1');
        const token1UserBefore = await token1.balanceOf(user.address);
        const answer = await renSwap['calc_withdraw_one_coin(uint256,int128)'](poolTokenUser, 1);

        await poolToken.connect(poolTokenProvider).transfer(proxy.address, poolTokenUser);

        await proxy.updateTokenMock(poolToken.address);

        const minAmount = mulPercent(answer, BigNumber.from('100').sub(slippage));
        const data = getCallData(
          hCurve,
          'removeLiquidityOneCoinUnderlying(address,address,address,uint256,int128,uint256)',
          [renSwap.address, poolToken.address, token1.address, poolTokenUser, 1, minAmount]
        );

        const receipt = await proxy.connect(user).execMock(hCurve.address, data, {
          value: ether('1'),
        });

        // Get handler return result
        const handlerReturn = (await getHandlerReturn(receipt, ['uint256']))[0];
        const token1UserEnd = await token1.balanceOf(user.address);
        expect(handlerReturn).to.be.eq(token1UserEnd.sub(token1UserBefore));

        // Check proxy balance
        expect(await token1.balanceOf(proxy.address)).to.be.eq(0);
        expect(await poolToken.balanceOf(proxy.address)).to.be.eq(0);

        // Check user
        expect(token1UserEnd).to.be.eq(token1UserBefore.add(answer));
      });
    });
  });
});
