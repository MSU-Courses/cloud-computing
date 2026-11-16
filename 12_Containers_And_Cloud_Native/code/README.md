# Примеры кода главы 12

В папке лежат примеры из главы "Контейнеры и cloud-native архитектура": небольшой сервис каталога на Node.js, два варианта его Dockerfile, пример определения задачи Amazon ECS и описание репозитория ECR на Terraform. Чтобы запустить примеры, нужен Docker Desktop или Docker Engine; Node.js на компьютере не обязателен, он есть внутри образа.

Сборка и запуск из папки `catalog`:

```bash
docker build -t catalog:1.4.0 .
docker run --rm -p 8080:3000 -e DATABASE_URL=postgres://db:5432/shop -e APP_VERSION=1.4.0 catalog:1.4.0
curl localhost:8080/products/42
```

Сервис работает, пока его не остановят. Остановить его можно сочетанием клавиш `Ctrl+C` в окне, где он запущен, или командой `docker stop <id контейнера>` из другого окна. Сервис к базе данных не подключается: адрес в `DATABASE_URL` нужен только для примера с конфигурацией.

| Файл | Раздел главы | Что показывает |
| --- | --- | --- |
| [catalog/server.js](catalog/server.js) | Запуск контейнера; Конфигурация в окружении (III); Процессы без состояния и остановка (VI, IX); Журналы (XI) | Чтение `PORT` и `DATABASE_URL` из окружения, журналы в stdout, обработка `SIGTERM`. На любой запрос, кроме `/health`, отвечает одним и тем же товаром с номером 42 |
| [catalog/package.json](catalog/package.json), [catalog/package-lock.json](catalog/package-lock.json) | Dockerfile | Описание пакета и зафиксированные зависимости для `npm ci` |
| [catalog/Dockerfile](catalog/Dockerfile) | Dockerfile; Порядок строк и кэш сборки | Dockerfile с зависимостями в отдельном слое до копирования кода |
| [catalog/Dockerfile.slow](catalog/Dockerfile.slow) | Порядок строк и кэш сборки | ОШИБКА НАМЕРЕННО: `COPY . .` до `npm ci`, зависимости пересобираются после каждой правки кода |
| [catalog/.dockerignore](catalog/.dockerignore) | Dockerfile | Файлы, которые не попадают в контекст сборки |
| [task-definition.json](task-definition.json) | Определение задачи и роли | Определение задачи Fargate: образ из ECR, порт, переменные, секрет из Secrets Manager, журналы `awslogs`. Номер аккаунта и ARN условные |
| [terraform/main.tf](terraform/main.tf) | Инфраструктура как код | Репозиторий ECR `catalog` с неизменяемыми тегами и сканированием при загрузке. Команды: `terraform init`, `terraform plan`, `terraform apply` (нужен настроенный AWS CLI; `apply` создаёт реальный ресурс) |

Медленный вариант собирают так: `docker build -f Dockerfile.slow -t catalog:slow .`
