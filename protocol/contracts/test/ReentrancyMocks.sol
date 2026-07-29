// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../tokendistribution/AutomatedDutchAuction.sol";

// INTENTIONAL: This is a malicious test contract to test reentrancy protection
// Slither warnings are expected - this contract intentionally receives ETH to test security
// slither-disable-next-line locked-ether
contract MaliciousReentrancyWithdraw {
    AutomatedDutchAuction public immutable auction;

    constructor(address payable _auctionAddress) {
        auction = AutomatedDutchAuction(_auctionAddress);
    }

    // This function will be called by the attacker's EOA to start the attack
    function attack() external {
        auction.withdrawProceeds();
    }

    // Fallback function to receive ETH and re-enter
    // INTENTIONAL: This contract intentionally locks ether to test reentrancy scenarios
    receive() external payable {
        // If there is still a balance in the auction contract,
        // it means the first transfer did not drain the contract,
        // so we try to withdraw again.
        if (address(auction).balance > 0) {
            auction.withdrawProceeds();
        }
    }
}