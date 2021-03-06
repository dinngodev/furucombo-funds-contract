// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IFurucomboProxy {
    function batchExec(
        address[] calldata tos,
        bytes32[] calldata configs,
        bytes[] memory datas
    ) external payable returns (address[] memory);

    function execs(
        address[] calldata tos,
        bytes32[] calldata configs,
        bytes[] memory datas
    ) external payable;
}
