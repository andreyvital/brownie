# Uses the Railway service linked to this folder (railway service link brownie)
mount := "/data"

default:
    @just --list

# Create the Railway volume for the WhatsApp session and attach it to the service (once)
whatsapp-volume:
    railway volume add --mount-path {{mount}}

# Stop sending from this Mac afterwards: two copies of one session that both send break each other
# Copy the local WhatsApp session (.whatsapp-auth/) to the Railway volume, replacing what's there
whatsapp-push:
    test -f .whatsapp-auth/creds.json || { echo "no local session: run bun run whatsapp first"; exit 1; }
    railway volume files --volume "$(just _volume)" upload .whatsapp-auth /whatsapp-auth --overwrite

# Name of the volume mounted at {{mount}}
[private]
_volume:
    @railway volume list --json | jq -er '[.volumes[] | select((.mountPath // .mount_path) == "{{mount}}")][0] | .name // .id'
