#!/bin/bash -xe
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

HOME=/home/ec2-user

# Install docker
sudo yum update -y
sudo yum install jq -y
sudo amazon-linux-extras install docker
sudo service docker start
sudo usermod -aG docker ec2-user

# Add some startup files
cat <<EOT >> /etc/systemd/system/docker_terraria.service
[Unit]
After=docker.service
Description=Start terraria in docker

[Service]
User=ec2-user
ExecStart=/home/ec2-user/start-terraria.sh

[Install]
WantedBy=multi-user.target
EOT

cat <<EOT >> /etc/systemd/system/update_ip.service
[Unit]
After=network.target
Description=Update IPs

[Service]
ExecStart=/home/ec2-user/update-ip.sh
User=ec2-user

[Install]
WantedBy=multi-user.target
EOT

cat << "EOT" >> /home/ec2-user/Dockerfile
FROM ryshe/terraria:latest

RUN apt-get update && apt-get install -y net-tools
EOT

docker build -t my-terraria:latest /home/ec2-user

cat << "EOT" >> /home/ec2-user/start-terraria.sh
#!/bin/bash
docker pull my-terraria:latest  # Every time we start the server, auto-get the latest terraria image.
docker run --rm --name="terraria" -p 7777:7777 -v $HOME/terraria/world:/root/.local/share/Terraria/Worlds my-terraria:latest -world /root/.local/share/Terraria/Worlds/worldFileName --log-opt max-size=200m -disable-commands
EOT

cat << "EOT" >> /home/ec2-user/backup-terraria.sh
#!/bin/bash

# Get the bucket name so we can backup the world
aws s3 cp $HOME/terraria/world "s3://s3BucketName" --recursive
EOT

cat << "EOT" >> /home/ec2-user/monitor-server.sh
#!/bin/bash

# get connection count
CONNECTION_COUNT=$(docker exec terraria  bash -c "netstat -an | grep 7777 | grep ESTABLISHED | wc -l")

# update connection count
aws cloudwatch put-metric-data --metric-name ActiveConnections --namespace Custom --value $CONNECTION_COUNT --region regionName

EOT

cat << "EOT" >> /home/ec2-user/test-api.sh
#!/bin/bash

# Your secret name
SECRET_NAME="secretName"

# AWS Region where the secret is stored
REGION_NAME="regionName"

# Use AWS CLI to fetch the secret value
SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $REGION_NAME --query SecretString --output text)

# Parse the secret JSON string
APIKEY=$(echo $SECRET_VALUE | jq -r .apiKey)
#PASSWORD=$(echo $SECRET_VALUE | jq -r .password)

echo "ApiKey: $APIKEY"
#echo "Password: $PASSWORD"
EOT

cat << "EOT" >> /home/ec2-user/update-ip.sh
#!/bin/bash

# This script is used to check and update your GoDaddy DNS server to the IP address of your current internet connection.
# Special thanks to mfox for his ps script
# https://github.com/markafox/GoDaddy_Powershell_DDNS
#
# First go to GoDaddy developer site to create a developer account and get your key and secret
#
# https://developer.godaddy.com/getstarted
# Be aware that there are 2 types of key and secret - one for the test server and one for the production server
# Get a key and secret for the production server
#

# Your secret name
SECRET_NAME="secretName"

# AWS Region where the secret is stored
REGION_NAME="regionName"

# Use AWS CLI to fetch the secret value
SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $REGION_NAME --query SecretString --output text)

# Parse the secret JSON string
APIKEY=$(echo $SECRET_VALUE | jq -r .apiKey)
APISECRET=$(echo $SECRET_VALUE | jq -r .apiSecret)

#Enter vaules for all variables, Latest API call requries them.


domain="domainName"                         # your domain
type="A"                                    # Record type A, CNAME, MX, etc.
name="subDomainName"                        # name of record to update
ttl="3600"                                  # Time to Live min value 600
port="1"                                    # Required port, Min value 1
weight="1"                                  # Required weight, Min value 1
key=$APIKEY                                 # key for godaddy developer API
secret=$APISECRET                           # secret for godaddy developer API

headers="Authorization: sso-key $key:$secret"

 echo $headers

result=$(curl -s -X GET -H "$headers" \
 "https://api.godaddy.com/v1/domains/$domain/records/$type/$name")

echo "result: " $result

dnsIp=$(echo $result | grep -oE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b")
 echo "dnsIp:" $dnsIp

# Get public ip address there are several websites that can do this.
ret=$(curl -s GET "http://ipinfo.io/json")
#echo $ret
currentIp=$(echo $ret | grep -oE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b")
 echo "currentIp:" $currentIp

 if [ $dnsIp != $currentIp ];
 then
        echo "IPs are not equal, updating record"
        curl -X PUT "https://api.godaddy.com/v1/domains/$domain/records/$type/$name" \
-H "accept: application/json" \
-H "Content-Type: application/json" \
-H "$headers" \
-d "[ { \"data\": \"$currentIp\", \"port\": $port, \"priority\": 0, \"protocol\": \"string\", \"service\": \"string\", \"ttl\": $ttl, \"weight\": $weight } ]"
fi
 if [ $dnsIp = $currentIp ];
 then
      echo "IPs are equal, no update required"
fi
EOT


# Adds a server backup every 10 min
echo "*/10 * * * * /home/ec2-user/backup-terraria.sh > /home/ec2-user/cron.log" >> /var/spool/cron/ec2-user
echo "* * * * * /home/ec2-user/monitor-server.sh > /home/ec2-user/monitor-server.log" >> /var/spool/cron/ec2-user

chmod +x $HOME/start-terraria.sh
chmod +x $HOME/backup-terraria.sh
chmod +x $HOME/monitor-server.sh
chmod +x $HOME/update-ip.sh

# Start docker every time the server starts
systemctl enable docker
systemctl enable docker_terraria.service
systemctl enable update_ip.service

systemctl start update_ip.service

# Load docker files for ec2-user
sudo -u ec2-user mkdir -p $HOME/terraria/world
chmod +rw $HOME/terraria
chmod +rw $HOME/terraria/world

echo "Trying to copy down world files, if they exist"

sudo -u ec2-user aws s3 cp "s3://s3BucketName" $HOME/terraria/world --recursive

FILE=$HOME/terraria/world/worldFileName
if [[ -f "$FILE" ]]; then
  echo "World file exists. Will use it."
  sudo -u ec2-user docker run --rm --name="terraria" -p 7777:7777 -v $HOME/terraria/world:/root/.local/share/Terraria/Worlds my-terraria:latest -world /root/.local/share/Terraria/Worlds/worldFileName --log-opt max-size=200m -disable-commands
else
  echo "World file does not exist. Creating new world"
  echo "Note: autocreate number is size of world, 1=small, 2=med, 3=large. Using 3 by default"
  size=3
  sudo -u ec2-user docker run --rm --name="terraria" -p 7777:7777 -v $HOME/terraria/world:/root/.local/share/Terraria/Worlds my-terraria:latest -world /root/.local/share/Terraria/Worlds/worldFileName --log-opt max-size=200m -disable-commands -autocreate "$size"
fi

