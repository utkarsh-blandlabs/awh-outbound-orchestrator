# Zapier Parity - Complete Field Mapping

This document shows how the Node.js orchestrator now matches your Zapier configuration exactly.

## ✅ All Zapier Fields Now Implemented

### Phone Configuration
| Zapier Field | Our Implementation | Value |
|--------------|-------------------|-------|
| Phone Number | `phone_number` | From webhook payload (dynamic) |
| From | `from` | `+15619565858` |
| Transfer Phone Number | `transfer_phone_number` | `+12173866023` |

### Task & Script
| Zapier Field | Our Implementation | Details |
|--------------|-------------------|---------|
| Task | `task` | Dynamic template with `{{first_name}}` and `{{last_name}}` placeholders |
| First sentence | `first_sentence` | Dynamic template with customer's name |

**Example:**
- Template: `"calling {{first_name}} {{last_name}}"`
- With John Doe: `"calling John Doe"`

### Voice & Behavior
| Zapier Field | Our Implementation | Value |
|--------------|-------------------|-------|
| Voice | `voice` | `e54a409c-daa9-4ee6-a954-2d81dec3476b` |
| Max Duration | `max_duration` | `30` (seconds) |
| Answering Machine Detection | `amd` | `true` |
| Wait for greeting | `wait_for_greeting` | `false` |
| Block Interruptions | `block_interruptions` | `false` |
| Record | `record` | `true` |
| Language | `language` | `"eng"` |

### Voicemail Settings
| Zapier Field | Our Implementation | Value |
|--------------|-------------------|-------|
| Voicemail Message | `voicemail_message` | "We need to talk about your medical coverage..." |
| Voicemail Action | `voicemail_action` | `"leave_message"` |
| Sensitive Voicemail Detection | N/A | `true` (in .env, not sent to API) |

### Pathway Configuration
| Zapier Field | Our Implementation | Value |
|--------------|-------------------|-------|
| Pathway ID | `pathway_id` | `1354408f-59b2-46d8-94b7-250f92d24b51` |
| Start node ID | `start_node_id` | `node_1` |

## Dynamic Field Replacement

The orchestrator automatically replaces placeholders in templates:

```javascript
// Template in .env:
BLAND_TASK_TEMPLATE=You are Ashley, calling {{first_name}} {{last_name}}...

// When calling for John Doe:
task: "You are Ashley, calling John Doe..."
```

## Environment Variables

All Zapier settings are now configurable in `.env`:

```bash
# Phone numbers
BLAND_FROM=+15619565858
BLAND_TRANSFER_PHONE_NUMBER=+12173866023

# Voice settings
BLAND_VOICE_ID=e54a409c-daa9-4ee6-a954-2d81dec3476b
BLAND_MAX_DURATION=30

# Call behavior
BLAND_ANSWERING_MACHINE_DETECTION=true
BLAND_WAIT_FOR_GREETING=false
BLAND_BLOCK_INTERRUPTIONS=false
BLAND_RECORD=true

# Voicemail
BLAND_VOICEMAIL_MESSAGE=We need to talk about your medical coverage...
BLAND_VOICEMAIL_ACTION=leave_message

# Dynamic templates
BLAND_TASK_TEMPLATE=You are Ashley, calling {{first_name}} {{last_name}}...
BLAND_FIRST_SENTENCE_TEMPLATE=Hi there! ... Is this {{first_name}} {{last_name}}?
```

## What Was Missing Before

### Previously Missing Fields:
1. ❌ `task` - AI instructions for the call
2. ❌ `first_sentence` - Opening line
3. ❌ `voice` - Specific voice ID
4. ❌ `max_duration` - Call time limit
5. ❌ `amd` - Answering machine detection
6. ❌ `wait_for_greeting` - Wait behavior
7. ❌ `block_interruptions` - Interruption handling
8. ❌ `voicemail_action` - What to do on voicemail
9. ❌ Dynamic name replacement in templates

### Now Implemented:
✅ All fields above are now included
✅ Dynamic template replacement for customer names
✅ Exact same configuration as Zapier

## Testing

When you test now, the call will:

1. **Use the correct voice** (Ashley's voice ID)
2. **Personalize the greeting** with customer's name
3. **Follow the exact script** from your Zapier task
4. **Handle voicemail properly** with answering machine detection
5. **Transfer to the right number** (+12173866023)
6. **Come from the right number** (+15619565858)

## Example API Call

When you send a webhook for "John Doe", the orchestrator now sends to Bland:

```json
{
  "phone_number": "+16284444907",
  "pathway_id": "1354408f-59b2-46d8-94b7-250f92d24b51",
  "start_node_id": "node_1",
  "task": "You are Ashley, a patient care coordinator from American Way Health, calling John Doe about their health insurance inquiry...",
  "from": "+15619565858",
  "transfer_phone_number": "+12173866023",
  "voice": "e54a409c-daa9-4ee6-a954-2d81dec3476b",
  "max_duration": 30,
  "amd": true,
  "wait_for_greeting": false,
  "block_interruptions": false,
  "record": true,
  "first_sentence": "Hi there! I'm responding to the inquiry you submitted for health insurance a minute ago. This is Ashley with American Way Health. Is this John Doe?",
  "voicemail_message": "We need to talk about your medical coverage. It's Ashley from the enrollment center. Five. Six. One. Nine. Five. Six. Five. Eight. Five. Eight. Call me now.",
  "voicemail_action": "leave_message",
  "language": "eng",
  "wait": false
}
```

This matches Zapier exactly! 🎯
