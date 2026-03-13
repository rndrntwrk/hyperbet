// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SkillOracle
 * @notice Receives TrueSkill or Glicko data (mu, sigma) from the game server
 *         and computes a skill-relative index price for perp markets.
 */
contract SkillOracle is Ownable {
    uint256 public constant Z_SCORE = 3;
    uint256 public constant K_FACTOR = 500;

    error InvalidReporter();
    error UnauthorizedReporter();

    struct AgentSkill {
        uint256 mu;
        uint256 sigma;
        uint256 lastUpdate;
    }

    mapping(bytes32 => AgentSkill) public agentSkills;
    bytes32[] public activeAgents;
    mapping(address => bool) public reporters;

    uint256 public globalMeanMu;
    uint256 private totalMu;
    uint256 public immutable basePrice;

    event SkillUpdated(bytes32 indexed agentId, uint256 mu, uint256 sigma);
    event ReporterUpdated(address indexed reporter, bool enabled);

    constructor(uint256 initialBasePrice) Ownable(msg.sender) {
        require(initialBasePrice > 0, "Invalid base price");
        basePrice = initialBasePrice;
        reporters[msg.sender] = true;
        emit ReporterUpdated(msg.sender, true);
    }

    modifier onlyReporter() {
        if (!reporters[msg.sender]) revert UnauthorizedReporter();
        _;
    }

    function setReporter(address reporter, bool enabled) external onlyOwner {
        if (reporter == address(0)) revert InvalidReporter();
        reporters[reporter] = enabled;
        emit ReporterUpdated(reporter, enabled);
    }

    function updateAgentSkill(bytes32 agentId, uint256 mu, uint256 sigma) external onlyReporter {
        if (agentSkills[agentId].lastUpdate == 0) {
            activeAgents.push(agentId);
            totalMu += mu;
        } else {
            totalMu = totalMu - agentSkills[agentId].mu + mu;
        }
        agentSkills[agentId] = AgentSkill(mu, sigma, block.timestamp);
        globalMeanMu = totalMu / activeAgents.length;
        emit SkillUpdated(agentId, mu, sigma);
    }

    function getConservativeSkill(bytes32 agentId) public view returns (int256) {
        require(agentSkills[agentId].lastUpdate != 0, "Agent not found");
        AgentSkill memory skill = agentSkills[agentId];
        return int256(skill.mu) - int256(Z_SCORE * skill.sigma);
    }

    // slither-disable-next-line timestamp
    function getIndexPrice(bytes32 agentId) public view returns (uint256) {
        int256 diff = getConservativeSkill(agentId) - int256(globalMeanMu);

        // Clamped linear approximation: price = basePrice * clamp(1 + diff/K_FACTOR, 0.01, ∞)
        int256 xScaled = (diff * 1e18) / int256(K_FACTOR);

        if (xScaled >= 0) {
            return (basePrice * (1e18 + uint256(xScaled))) / 1e18;
        }

        uint256 absX = uint256(-xScaled);
        if (absX >= 1e18) {
            return basePrice / 100; // floor at 1% of base price
        }
        return (basePrice * (1e18 - absX)) / 1e18;
    }
}
