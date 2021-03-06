// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import {HandlerBase} from "../HandlerBase.sol";
import {ISwapRouter} from "./ISwapRouter.sol";
import {BytesLib} from "./libraries/BytesLib.sol";

// @title: UniswapV3 Handler
contract HUniswapV3 is HandlerBase {
    using BytesLib for bytes;

    ISwapRouter public constant ROUTER = ISwapRouter(0xE592427A0AEce92De3Edee1F18E0157C05861564);

    uint256 private constant PATH_SIZE = 43; // address + fee(uint24) + address
    uint256 private constant ADDRESS_SIZE = 20;

    function getContractName() public pure override returns (string memory) {
        return "HUniswapV3";
    }

    function exactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountOut) {
        _notMaticToken(tokenIn);

        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInputSingle(0, tokenIn, tokenOut, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add output token to stack
        _updateToken(tokenOut);
    }

    /// @notice Swap token with exact input, path can be multiple tokens.
    /// @dev Need to do _updateToken() in every token of path except input token for checking dealing assets.
    function exactInput(
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) external payable returns (uint256 amountOut) {
        // Get tokenIn
        address tokenIn = _getFirstToken(path);
        _notMaticToken(tokenIn);

        // Get tokenIn balance
        amountIn = _getBalance(tokenIn, amountIn);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountIn);

        // Swap token
        amountOut = _exactInput(0, path, amountIn, amountOutMinimum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        address[] memory addressPath = _bytesPathToAddressPath(path);

        // From the 2nd token of addressPath, because addressPath[0] will be update by previous cubes
        for (uint256 i = 1; i < addressPath.length; i++) {
            _updateToken(addressPath[i]);
        }
    }

    function exactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) external payable returns (uint256 amountIn) {
        _notMaticToken(tokenIn);

        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutputSingle(0, tokenIn, tokenOut, fee, amountOut, amountInMaximum, sqrtPriceLimitX96);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        // Add token out to stack
        _updateToken(tokenOut);
    }

    function exactOutput(
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) external payable returns (uint256 amountIn) {
        // Get tokenIn
        address tokenIn = _getLastToken(path);
        _notMaticToken(tokenIn);

        // Get tokenIn balance
        amountInMaximum = _getBalance(tokenIn, amountInMaximum);

        // Approve token
        _tokenApprove(tokenIn, address(ROUTER), amountInMaximum);

        // Swap token
        amountIn = _exactOutput(0, path, amountOut, amountInMaximum);

        // Reset approved amount
        _tokenApproveZero(tokenIn, address(ROUTER));

        address[] memory addressPath = _bytesPathToAddressPath(path);

        // The exactOutput() path is reverse with exactInput(). From the 1st to the last two token of addressPath, because addressPath[length - 1] will be update by previous cubes.
        for (uint256 i = 0; i < addressPath.length - 1; i++) {
            _updateToken(addressPath[i]);
        }
    }

    function _getFirstToken(bytes memory path) internal pure returns (address) {
        return path.toAddress(0);
    }

    function _getLastToken(bytes memory path) internal pure returns (address) {
        _requireMsg(path.length >= PATH_SIZE, "_getLastToken", "Path size too small");
        return path.toAddress(path.length - ADDRESS_SIZE);
    }

    /// @notice Convert bytes format path to address array format path.
    /// @dev UniswapV3 bytes format path is in "address + fee(uint24) + address + fee(uint24) + ... + address".
    /// @return The address array path.
    function _bytesPathToAddressPath(bytes memory path) internal pure returns (address[] memory) {
        _requireMsg(path.length >= PATH_SIZE, "_bytesPathToAddressPath", "Path size too small");

        uint256 addressAndFeeLen = PATH_SIZE - ADDRESS_SIZE;
        uint256 tokenNum = (path.length - ADDRESS_SIZE) / addressAndFeeLen + 1;
        address[] memory addressPath = new address[](tokenNum);

        for (uint256 i = 0; i < tokenNum; i++) {
            addressPath[i] = path.toAddress(i * addressAndFeeLen);
        }
        return addressPath;
    }

    function _exactInputSingle(
        uint256 value,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        // Try swap token
        try ROUTER.exactInputSingle{value: value}(params) returns (uint256 amountOut) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInputSingle", reason);
        } catch {
            _revertMsg("exactInputSingle");
        }
    }

    function _exactInput(
        uint256 value,
        bytes memory path,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum
        });

        // Try swap token
        try ROUTER.exactInput{value: value}(params) returns (uint256 amountOut) {
            return amountOut;
        } catch Error(string memory reason) {
            _revertMsg("exactInput", reason);
        } catch {
            _revertMsg("exactInput");
        }
    }

    function _exactOutputSingle(
        uint256 value,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp,
            amountOut: amountOut,
            amountInMaximum: amountInMaximum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        // Try swap
        try ROUTER.exactOutputSingle{value: value}(params) returns (uint256 amountIn) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutputSingle", reason);
        } catch {
            _revertMsg("exactOutputSingle");
        }
    }

    function _exactOutput(
        uint256 value,
        bytes memory path,
        uint256 amountOut,
        uint256 amountInMaximum
    ) internal returns (uint256) {
        // Init struct
        ISwapRouter.ExactOutputParams memory params = ISwapRouter.ExactOutputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp,
            amountOut: amountOut,
            amountInMaximum: amountInMaximum
        });

        // Try swap token
        try ROUTER.exactOutput{value: value}(params) returns (uint256 amountIn) {
            return amountIn;
        } catch Error(string memory reason) {
            _revertMsg("exactOutput", reason);
        } catch {
            _revertMsg("exactOutput");
        }
    }
}
