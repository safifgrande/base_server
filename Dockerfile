# Start from the base image on Docker Hub
FROM node:slim

# Set the working directory
WORKDIR /app

# Copy your project files to the container
COPY . .

# Install dependencies
RUN npm install

# Install nodemon
RUN npm install -g nodemon

# Expose the application port
EXPOSE 6000

# Run the application
CMD ["npm", "run", "dev"]