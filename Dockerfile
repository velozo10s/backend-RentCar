# 1. Usar una imagen base oficial de Node
FROM node:20-alpine

# 2. Crear directorio de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiar archivos de dependencias
COPY package*.json ./

# 4. Instalar dependencias (usa npm o yarn según tu proyecto)
RUN npm install

# 5. Copiar el resto del código de la app
COPY . .

# 6. Asegurarse de que la carpeta de uploads exista (evita errores si se usa multer)
RUN mkdir -p uploads/docs

# 7. Exponer el puerto que usa tu app
EXPOSE 5000

# 8. Comando por defecto para iniciar la app
CMD ["npm", "start"]
