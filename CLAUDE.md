# Contexte VPS

Ce VPS est partagé avec d'autres projets :
- /home/keolis/ → projet-keolis-auxerre (NE PAS TOUCHER)
- /home/educnat/ → educnat (NE PAS TOUCHER)
- /home/openclaw/ → CE PROJET

SSH : ubuntu@146.59.233.252 (clé SSH configurée, sudo sans mot de passe)
Docker network existant : nginx-proxy-manager_default

## Projet Lead Gen MessagingMe

- Répertoire cible : /home/openclaw/leadgen/
- Développement directement sur le VPS via SSH
- Ne pas toucher aux containers Keolis (ports 3000/3002) ni educnat
- OpenClaw à installer sur le VPS
- Supabase déjà créé (projet externe, free tier)

### TODO Sécurité
- **Port 3005 exposé sur 0.0.0.0** : le process Node.js leadgen écoute sur toutes les interfaces. Il faut le binder sur 127.0.0.1 et le mettre derrière Nginx Proxy Manager (comme les autres apps) pour bénéficier du HTTPS et des headers de sécurité.
