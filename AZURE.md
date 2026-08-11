# Azure App Service (Linux) — Quik Coach
# Deploy with Azure CLI once installed and logged in:
#
#   az login
#   az group create -n rg-quikcoach -l australiaeast
#   az appservice plan create -g rg-quikcoach -n plan-quikcoach --sku B1 --is-linux
#   az webapp create -g rg-quikcoach -p plan-quikcoach -n <unique-name> --runtime "NODE:22-lts"
#   az webapp config appsettings set -g rg-quikcoach -n <unique-name> \
#     --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true WEBSITES_PORT=8080
#   az webapp config set -g rg-quikcoach -n <unique-name> --web-sockets-enabled true \
#     --startup-file "bash startup.sh"
#   az webapp up -g rg-quikcoach -n <unique-name> --runtime "NODE:22-lts" --os-type Linux
#
# App URL: https://<unique-name>.azurewebsites.net
