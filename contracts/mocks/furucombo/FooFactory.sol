// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {Foo} from "./Foo.sol";

contract FooFactory {
    mapping(uint256 => address) private _foos;
    uint256 private _nFoo;

    constructor() {
        _nFoo = 0;
        createFoo();
    }

    function addressOf(uint256 index_) public view returns (address foo) {
        require(index_ < _nFoo);
        return _foos[index_];
    }

    function createFoo() public {
        Foo f = new Foo();
        _foos[_nFoo] = address(f);
        _nFoo++;
    }
}
