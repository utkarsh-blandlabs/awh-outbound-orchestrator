# Convoso Status Codes - Complete Reference

## Overview

Convoso uses **71 official status codes** to categorize call outcomes. These are divided into two main categories:

- **HUMAN (27 codes)**: Call was answered by a human, AI had a conversation
- **SYSTEM (44 codes)**: Technical/system outcomes, no human conversation occurred

## Understanding HUMAN vs SYSTEM

### HUMAN Contact Types (27 codes)

These codes represent outcomes where **a real person answered the phone** and the AI agent had an actual conversation with them.

**Characteristics:**
- Phone was answered by a human being
- AI engaged in dialogue (even if brief)
- Outcome determined by conversation content
- Examples: Sale, Transfer, Not Interested, Callback Request

**Why it matters:** These contacts represent actual engagement with your target audience. They indicate successful connection and conversation, regardless of outcome.

### SYSTEM Contact Types (44 codes)

These codes represent **technical or system-level outcomes** where no meaningful human conversation occurred.

**Characteristics:**
- Call didn't connect to a human
- Technical issues prevented conversation
- System-level blocking or detection
- Examples: No Answer, Busy, Disconnected Number, DNC Match

**Why it matters:** These help identify technical issues, invalid numbers, and compliance blocks. They don't represent engagement with your audience.

---

## Complete Status Code Reference

### HUMAN Contact Types (27 codes)

#### Sales & Successful Outcomes
| Code | Description | Contact Type |
|------|-------------|--------------|
| `SALE` | Sale | HUMAN |

#### Transfers
| Code | Description | Contact Type |
|------|-------------|--------------|
| `ACA` | Transferred to ACA | HUMAN |
| `BASACA` | Transfer to ACA (alternate) | HUMAN |
| `FRONT` | Front Hand-off | HUMAN |
| `FRNTRS` | Front Transfers | HUMAN |
| `SPA` | Transferred To Spanish | HUMAN |
| `TCR` | Transferred To Customer Service | HUMAN |

#### Call Status & Requests
| Code | Description | Contact Type |
|------|-------------|--------------|
| `A` | Answering Machine | HUMAN |
| `CB` | Requested Callback | HUMAN |
| `POST` | Post Date | HUMAN |
| `1095A` | Requested 10-95A Form | HUMAN |

#### Interest Levels
| Code | Description | Contact Type |
|------|-------------|--------------|
| `NI` | Not Interested | HUMAN |
| `NOTA` | Not Available | HUMAN |

#### Negative Outcomes
| Code | Description | Contact Type |
|------|-------------|--------------|
| `BACA` | Bad State/Cannot Sell | HUMAN |
| `CA` | Cannot Afford | HUMAN |
| `NOTCOV` | Not Looking for Coverage | HUMAN |
| `PIKER` | Declined Sale - PIKER | HUMAN |
| `WRONG` | Wrong Number | HUMAN |
| `BPN` | Bad Phone Number | HUMAN |
| `MGMTNQ` | Disqualified Lead | HUMAN |
| `CD` | Customer Disconnected | HUMAN |

#### Inquiries
| Code | Description | Contact Type |
|------|-------------|--------------|
| `MCAID` | Medicaid Inquiry | HUMAN |
| `MCARE` | Medicare Inquiry | HUMAN |
| `TRICAR` | Medicare/Tricare | HUMAN |
| `REQID` | Requested ID Card Number | HUMAN |

---

### SYSTEM Contact Types (44 codes)

#### No Answer / Not Connected
| Code | Description | Contact Type |
|------|-------------|--------------|
| `NA` | No Answer AutoDial | SYSTEM |
| `NAIC` | No Answer Inbound Call | SYSTEM |
| `NRA` | No Route Available | SYSTEM |
| `NEW` | New Lead | SYSTEM |

#### Busy / Hung Up
| Code | Description | Contact Type |
|------|-------------|--------------|
| `B` | System Busy | SYSTEM |
| `CALLHU` | Caller Hung Up | SYSTEM |
| `PBXHU` | Call ended at PBX | SYSTEM |
| `AH` | Answered & Hung-up | SYSTEM |

#### Disconnected / Network Issues
| Code | Description | Contact Type |
|------|-------------|--------------|
| `DC` | Disconnected Number | SYSTEM |
| `NORD` | Network Out Of Order | SYSTEM |

#### Congestion
| Code | Description | Contact Type |
|------|-------------|--------------|
| `CG` | Congestion | SYSTEM |
| `CGD` | Congestion Account Disconnected | SYSTEM |
| `CGO` | Congestion Out of Minutes | SYSTEM |
| `CGT` | Congested Temporarily | SYSTEM |

#### Do Not Call (DNC)
| Code | Description | Contact Type |
|------|-------------|--------------|
| `DNC` | Do NOT Call | SYSTEM |
| `DNCC` | A match for Campaign DNC settings | SYSTEM |
| `DNCDEC` | DNC-Carrier Received Decline Request | SYSTEM |
| `DNCL` | Do NOT Call Hopper Match | SYSTEM |
| `DNCLCC` | Do NOT Call Lead Consent Concern | SYSTEM |
| `DNCNFD` | DNC-Carrier Reports Number Not Found | SYSTEM |
| `DNCQ` | Queue Set Call To DNC | SYSTEM |
| `DNCRT` | Do NOT Call Real Time Match | SYSTEM |
| `DNCW` | Do NOT Call Wireless Number | SYSTEM |

#### Answering Machine Detection
| Code | Description | Contact Type |
|------|-------------|--------------|
| `AA` | Answering Machine Detected | SYSTEM |
| `AM` | Answering Machine Detected Message Left | SYSTEM |
| `AHXFER` | Queue After Hours Action Trigger | SYSTEM |

#### Agent Issues
| Code | Description | Contact Type |
|------|-------------|--------------|
| `DROP` | Agent Not Available In Campaign | SYSTEM |
| `ERI` | Agent Lost Connection | SYSTEM |
| `LOGOUT` | Agent Force Logout | SYSTEM |

#### Call Handling
| Code | Description | Contact Type |
|------|-------------|--------------|
| `DONE` | Call Done | SYSTEM |
| `REJ` | Call Rejected | SYSTEM |
| `PU` | Call Picked Up | SYSTEM |
| `INCOMP` | Incomplete Call | SYSTEM |
| `INCALL` | Lead In Call | SYSTEM |

#### Detection Systems
| Code | Description | Contact Type |
|------|-------------|--------------|
| `FASD` | FAS Detected | SYSTEM |
| `AFAX` | CPD Fax | SYSTEM |
| `CIDB` | Blocked Caller ID | SYSTEM |

#### PBX / Queue Operations
| Code | Description | Contact Type |
|------|-------------|--------------|
| `PXDROP` | Drop Call to PBX Application | SYSTEM |
| `QDROP` | Drop Call to Another Queue | SYSTEM |
| `WAITTO` | Queue Drop Call Action Trigger | SYSTEM |
| `XDROP` | Call Abandoned In Queue | SYSTEM |
| `PDROP` | Pre-Routing Drop | SYSTEM |

#### System Errors
| Code | Description | Contact Type |
|------|-------------|--------------|
| `N` | Dead Air/System Glitch | SYSTEM |
| `OI` | Operator Intercept | SYSTEM |
| `IMPL` | Improper Logout | SYSTEM |
| `FORBID` | Forbidden | SYSTEM |

---

## How the Orchestrator Maps Outcomes

The AWH Outbound Orchestrator maps Bland.ai call outcomes to Convoso status codes using the following logic:

### Primary Mapping (from `CONVOSO_STATUS_MAP`)

Bland outcomes are first normalized and looked up in the `CONVOSO_STATUS_MAP` object in [src/types/awh.ts](src/types/awh.ts).

### Fuzzy Matching (Fallback)

If no direct match is found, fuzzy matching is used:

| Bland Outcome | Convoso Code | Type | Description |
|---------------|--------------|------|-------------|
| Contains "transfer" | `ACA` | HUMAN | Transferred to ACA |
| Contains "voicemail" or "machine" | `A` | HUMAN | Answering Machine |
| Contains "callback" or "call_back" | `CB` | HUMAN | Requested Callback |
| Contains "sale" | `SALE` | HUMAN | Sale |
| Contains "confus" | `CD` | HUMAN | Customer Disconnected |
| Contains "not_interest" or "ni" | `NI` | HUMAN | Not Interested |
| Contains "no_answer" or "noanswer" | `NA` | SYSTEM | No Answer AutoDial |
| Contains "busy" | `B` | SYSTEM | System Busy |
| Contains "hang" or "hangup" | `CALLHU` | SYSTEM | Caller Hung Up |
| Contains "disconnect" | `DC` | SYSTEM | Disconnected Number |
| Contains "dead" | `N` | SYSTEM | Dead Air/System Glitch |
| Contains "wrong" | `WRONG` | HUMAN | Wrong Number |
| Contains "bad_phone" | `BPN` | HUMAN | Bad Phone Number |

### Default Fallback

If no match is found, the system defaults to:
- **Code**: `N` (Dead Air/System Glitch)
- **Type**: SYSTEM
- **Reason**: Valid catch-all for unrecognized outcomes

---

## Common Scenarios

### Scenario 1: Successful Transfer
- **Bland Outcome**: `TRANSFERRED`
- **Convoso Code**: `ACA`
- **Contact Type**: HUMAN
- **Meaning**: Person answered, qualified, and was transferred to an agent

### Scenario 2: Voicemail Left
- **Bland Outcome**: `VOICEMAIL`
- **Convoso Code**: `A`
- **Contact Type**: HUMAN
- **Meaning**: Call went to voicemail, message was left

### Scenario 3: Callback Requested
- **Bland Outcome**: `CALLBACK`
- **Convoso Code**: `CB`
- **Contact Type**: HUMAN
- **Meaning**: Person answered and requested a callback

### Scenario 4: No Answer
- **Bland Outcome**: `NO_ANSWER`
- **Convoso Code**: `NA`
- **Contact Type**: SYSTEM
- **Meaning**: Phone rang but nobody picked up

### Scenario 5: Not Interested
- **Bland Outcome**: `NOT_INTERESTED`
- **Convoso Code**: `NI`
- **Contact Type**: HUMAN
- **Meaning**: Person answered but declined the offer

---

## Important Notes

### ⚠️ ONLY Send Status Abbreviations

Convoso requires **ONLY** the status code abbreviation, **NOT** the description.

✅ **Correct**: `"status": "ACA"`
❌ **Wrong**: `"status": "Transferred to ACA"`

### ⚠️ Invalid Codes Previously Used

The following codes were being used but are **NOT** in the official Convoso status table:

- ❌ `CALLXR` - Not a valid code (use `ACA` for transfers instead)
- ❌ `CALLBK` - Not a valid code (use `CB` for callbacks instead)
- ❌ `NOANSR` - Not a valid code (use `NA` for no answer instead)
- ❌ `UB` - Not a valid code (use `B` for busy instead)
- ❌ `UNKNWN` - Not a valid code (use `N` for unknown outcomes instead)
- ❌ `CC` - Not a valid code (use `CD` for confused/disconnected instead)

These have all been fixed in the current implementation.

---

## Files Modified

1. **[src/types/awh.ts](src/types/awh.ts)** - Updated `CONVOSO_STATUS_MAP` with all 71 codes
2. **[src/services/convosoService.ts](src/services/convosoService.ts)** - Fixed `mapOutcomeToConvosoStatus()` to use only valid codes

---

*Updated: 2025-12-10*
*Reference: Official Convoso Status Code Table (71 codes)*
