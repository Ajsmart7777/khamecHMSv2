import os

env_path = "/home/ubuntu/medflow-connect-32/.env"
if os.path.exists(env_path):
    with open(env_path) as f:
        print(f.read())
else:
    print(".env not found in project root")

parent_env = "/home/ubuntu/.env"
if os.path.exists(parent_env):
    with open(parent_env) as f:
        print("Parent .env:")
        print(f.read())
