# Hands-on 13.1. Граница разрешений, журнал действий и проверка настроек

В этом занятии три механизма из главы проверяются на настоящем аккаунте. Сначала вы создадите роль, которой выданы широкие права, но задана граница разрешений `DevBoundary`, примете эту роль в CloudShell и убедитесь, что роль не выходит за границу. Затем найдёте отклонённый вызов в журнале CloudTrail и по записи восстановите, кто его выполнил и с каким ключом.

Во второй половине занятия вы намеренно откроете тестовый бакет для чтения всем. Эту ошибку заметят два сервиса: IAM Access Analyzer сообщит о внешнем доступе, а правило AWS Config пометит бакет как несоответствующий. Потом вы закроете бакет и увидите, как оба сервиса сами отметят исправление.

## Что получится в конце

- Политика-граница `DevBoundary`, политика `DevRolePolicy` и роль `dev-function-role`, у которой права ограничены границей.
- Три вызова от имени роли: один разрешён, два отклонены по разным причинам.
- Найденный в CloudTrail отклонённый вызов `CreateRole` и связанный с ним вызов `AssumeRole`.
- Анализатор внешнего доступа `security-lab` и его находка о публичном бакете.
- Правило AWS Config `s3-bucket-public-read-prohibited` и история изменений бакета.

## Перед началом

- Вы входите в консоль как пользователь IAM с правами администратора, например с политикой `AdministratorAccess`, а не как root-пользователь. Root-пользователь не может принимать роли: в шаге 5 STS ответит ему ошибкой `Roles may not be assumed by root accounts`.
- В консоли AWS выбран регион `Europe (Frankfurt)`. В части 3 вы на время переключитесь на `US East (N. Virginia)`.
- Вы умеете открывать AWS CloudShell: значок терминала в верхней панели консоли или сервис `CloudShell`.
- На занятие понадобится от часа до полутора.

> [!NOTE]
> История событий CloudTrail бесплатна[^1], анализатор внешнего доступа IAM Access Analyzer тоже не стоит денег[^2]. AWS Config берёт плату за каждый записанный элемент конфигурации (configuration item) и за каждую проверку правила[^3]. В занятии Config записывает только бакеты S3, поэтому элементов и проверок будет несколько десятков, а это меньше 0,10 USD. Плата начисляется, пока запись включена, поэтому не пропускайте часть 7.

## Часть 1. Граница разрешений

Повторим пример из раздела "Границы разрешений" главы. Администратор написал границу: роли разработчиков могут только читать объекты S3 и писать журналы. Разработчик создаёт роль для своей функции и выдаёт ей больше: чтение объектов и создание ролей.

### Шаг 1. Создайте бакет с тестовым файлом

Откройте CloudShell и выполните команды:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3 mb s3://security-lab-$ACCOUNT
echo 'hello from security lab' | aws s3 cp - s3://security-lab-$ACCOUNT/hello.txt
```

Первая строка записывает номер аккаунта в переменную `ACCOUNT`. Имена бакетов уникальны во всём мире, и номер аккаунта в имени делает его уникальным. Третья строка передаёт текст прямо в объект `hello.txt`: дефис вместо имени файла означает "взять данные из ввода команды", поэтому файл на диске не нужен.

```text
make_bucket: security-lab-111122223333
```

Вместо `111122223333` у вас будет номер вашего аккаунта. Загрузка из ввода ничего не выводит.

> [!TIP]
> Переменная `ACCOUNT` живёт только в текущей сессии CloudShell и пропадает, если CloudShell перезапустился после простоя. Поэтому каждый блок команд, где она нужна, начинается с той же строки `ACCOUNT=...`.

### Шаг 2. Создайте границу DevBoundary

Откройте `IAM` → `Policies` → `Create policy` и переключите редактор на `JSON`. Вставьте политику:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadObjects",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "*"
    },
    {
      "Sid": "WriteLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

Нажмите `Next`. `Policy name`: `DevBoundary`. Нажмите `Create policy`.

По виду это обычная политика IAM, и создаётся она так же. Границей её делает только способ подключения к роли: в шаге 4 вы прикрепите её не как политику разрешений, а как границу.

### Шаг 3. Создайте политику роли DevRolePolicy

Снова нажмите `Create policy`, переключите редактор на `JSON` и вставьте права, которые разработчик хочет выдать своей функции:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeveloperWish",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "iam:CreateRole"],
      "Resource": "*"
    }
  ]
}
```

`Policy name`: `DevRolePolicy`. Нажмите `Create policy`.

Право `iam:CreateRole` - путь к повышению привилегий из главы. Роль, которая может создавать роли, может создать роль администратора.

### Шаг 4. Создайте роль с границей

Откройте `Roles` → `Create role`.

![13.1.1. Доверенная сущность роли](../_images/13/hands_on/ho1_01_role_trust.jpg)

_13.1.1. Доверенная сущность роли_

1. `Trusted entity type`: `AWS account` (_1_).
2. `An AWS account`: `This account` (_2_). Роль смогут принимать пользователи и роли вашего аккаунта, если им это разрешено.

Настоящая роль функции Lambda доверяла бы сервису Lambda, как в девятой главе. Здесь роль доверяет вашему аккаунту, чтобы вы могли принять её сами и проверить её права из CloudShell.

Нажмите `Next`. На странице `Add permissions`:

![13.1.2. Политика роли и граница разрешений](../_images/13/hands_on/ho1_02_role_boundary.jpg)

_13.1.2. Политика роли и граница разрешений_

1. Оставьте `Use existing policy`, найдите в поиске `DevRolePolicy` и отметьте её (_3_).
2. Раскройте блок `Set permissions boundary - optional` и выберите `Use a permissions boundary to control the maximum role permissions` (_4_).
3. В появившемся списке найдите `DevBoundary` и выберите её (_5_).

Нажмите `Next`. `Role name`: `dev-function-role`.

Прокрутите страницу до блока `Step 2: Add permissions`.

![13.1.3. Две политики роли в сводке](../_images/13/hands_on/ho1_03_role_review.jpg)

_13.1.3. Две политики роли в сводке_

В столбце `Attached as` видно, как подключена каждая политика: `DevBoundary` - `Boundary policy` (_6_), `DevRolePolicy` - `Permissions policy` (_7_). Нажмите `Create role`.

## Часть 2. Проверка прав роли

### Шаг 5. Примите роль

Опишите в CloudShell профиль AWS CLI, который работает от имени роли:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws configure set profile.dev.role_arn arn:aws:iam::$ACCOUNT:role/dev-function-role
aws configure set profile.dev.credential_source EcsContainer
aws configure set profile.dev.role_session_name lab-test
```

Команды записали в файл `~/.aws/config` профиль `dev` из трёх параметров:

- `role_arn` - какую роль принимать.
- `credential_source` - чьими учётными данными вызывать `AssumeRole`. CloudShell выдаёт программам учётные данные вашего пользователя так же, как ECS выдаёт контейнеру учётные данные роли задачи, поэтому источник называется `EcsContainer`.
- `role_session_name` - имя сессии. По нему вызовы роли будет видно в журнале.

Проверьте, от чьего имени работает профиль:

```bash
aws sts get-caller-identity --profile dev
```

```json
{
    "UserId": "AROA...:lab-test",
    "Account": "111122223333",
    "Arn": "arn:aws:sts::111122223333:assumed-role/dev-function-role/lab-test"
}
```

Перед этой командой AWS CLI сам вызвал `AssumeRole` и получил временные учётные данные роли: ключ доступа, секретный ключ и токен сессии. Они действуют один час. CLI хранит их в папке `~/.aws/cli/cache`, чтобы не принимать роль перед каждой командой. Ключ временных учётных данных начинается с `ASIA`, а постоянный ключ пользователя IAM - с `AKIA`.

Дальше каждая команда с `--profile dev` выполняется от имени роли, а без него - от имени вашего пользователя.

> [!WARNING]
> Если вместо ответа появилась ошибка `Roles may not be assumed by root accounts`, вы вошли в консоль как root-пользователь. Выйдите, войдите как пользователь IAM и повторите шаг.

### Шаг 6. Прочитайте объект

```bash
aws s3 cp s3://security-lab-$ACCOUNT/hello.txt - --profile dev
```

```text
hello from security lab
```

Дефис вместо имени файла выводит содержимое объекта в терминал. Чтение разрешено: `s3:GetObject` есть и в политике роли, и в границе.

### Шаг 7. Попробуйте создать роль

Попробуем то, ради чего разработчик выдал роли право `iam:CreateRole`: создать новую роль.

```bash
aws iam create-role --profile dev --role-name admin-for-me --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
```

Параметр `--assume-role-policy-document` - политика доверия новой роли: её сможет принимать сервис Lambda.

```text
aws: [ERROR]: An error occurred (AccessDenied) when calling the CreateRole operation: User: arn:aws:sts::111122223333:assumed-role/dev-function-role/lab-test is not authorized to perform: iam:CreateRole on resource: arn:aws:iam::111122223333:role/admin-for-me because no permissions boundary allows the iam:CreateRole action. Go to https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/authorization-details/40zs3ri1uj0ai60g24l56lyj7 for complete details, or call the GetRequestAuthorizationDetails API with the following authorization id: 40zs3ri1uj0ai60g24l56lyj7
```

Сообщение называет причину отказа: `because no permissions boundary allows the iam:CreateRole action`. Политика роли разрешает действие, но граница - нет.

### Шаг 8. Откройте подробности отказа

Скопируйте из сообщения адрес, который начинается с `https://us-east-1.console.aws.amazon.com/iam/home`, и откройте его в браузере, где вы вошли в консоль.

![13.1.4. Подробности отказа в консоли IAM](../_images/13/hands_on/ho1_04_authorization_details.jpg)

_13.1.4. Подробности отказа в консоли IAM_

Страница `Access denied for iam:CreateRole` показывает, как AWS проверял запрос:

- `Principal` (_8_) - политика роли. Её проверка дала `Allow`: `DevRolePolicy` разрешает `iam:CreateRole`.
- `Permissions boundary` (_9_) - граница. Её проверка дала `Implicit deny`, неявный запрет: ни одна строка `DevBoundary` не разрешает это действие.
- `Session` (_10_) - ограничения сессии. Политику сессии при принятии роли никто не передавал, поэтому здесь `Allow`.
- `Result` (_11_): `Implicit deny`. Достаточно одного запрета, чтобы весь запрос был отклонён.

Справа в блоке `Evaluation details` перечислены ключи контекста запроса: `aws:SourceIp`, `aws:SecureTransport`, `aws:MultiFactorAuthPresent` и другие. Эти ключи можно использовать в блоке `Condition` политик.

### Шаг 9. Попробуйте создать поток журнала

Функция пишет журнал в два действия: создаёт поток журнала (`logs:CreateLogStream`) и записывает в него события (`logs:PutLogEvents`). Граница разрешает оба действия.

```bash
aws logs create-log-stream --profile dev --log-group-name /aws/lambda/dev-function --log-stream-name test
```

```text
aws: [ERROR]: An error occurred (AccessDeniedException) when calling the CreateLogStream operation: User: arn:aws:sts::111122223333:assumed-role/dev-function-role/lab-test is not authorized to perform: logs:CreateLogStream on resource: arn:aws:logs:eu-central-1:111122223333:log-group:/aws/lambda/dev-function:log-stream:test because no identity-based policy allows the logs:CreateLogStream action
```

Причина другая: `because no identity-based policy allows`. Граница действие разрешает, но в политике роли его нет. Группы журналов `/aws/lambda/dev-function` не существует, но до проверки её существования дело не дошло: AWS сначала проверяет права.

### Шаг 10. Сравните результаты с главой

| Действие               | Разрешает политика роли? | Разрешает граница? | Результат в CloudShell            |
| ---------------------- | ------------------------ | ------------------ | --------------------------------- |
| `s3:GetObject`         | Да                       | Да                 | Файл прочитан                     |
| `iam:CreateRole`       | Да                       | Нет                | `no permissions boundary allows`  |
| `logs:CreateLogStream` | Нет                      | Да                 | `no identity-based policy allows` |

Это три строки таблицы из раздела "Границы разрешений" главы. Действие выполняется, только если его разрешают обе политики. Граница сама прав не добавляет, а политика роли не может выйти за границу.

## Часть 3. Журнал CloudTrail

### Шаг 11. Найдите отклонённый вызов

IAM - глобальный сервис, и CloudTrail записывает его события в регион `us-east-1`[^4]. Переключите регион в правом верхнем углу консоли на `US East (N. Virginia)`, откройте сервис `CloudTrail` и раздел `Event history`.

![13.1.5. События CreateRole в истории событий](../_images/13/hands_on/ho1_05_event_history.jpg)

_13.1.5. События CreateRole в истории событий_

В блоке `Lookup attributes` выберите `Event name` (_12_) и введите `CreateRole` (_13_). События появляются в истории в течение нескольких минут после вызова. Если списка нет, подождите и обновите страницу.

Вверху списка два события с одинаковым именем:

- В столбце `User name` стоит `lab-test` (_14_), а `Resource name` пуст. Это ваш отклонённый вызов из шага 7: в столбце показано имя сессии роли, а роль `admin-for-me` так и не появилась.
- Ниже событие с вашим именем пользователя и ресурсом `dev-function-role` (_15_). Это создание роли в шаге 4: консоль вызвала тот же `CreateRole` от вашего имени.

Ниже могут быть и другие события `CreateRole`: история хранит 90 дней, и в неё попали роли из прошлых занятий.

> [!NOTE]
> Если в регионе `Europe (Frankfurt)` искать `CreateRole`, список будет пустым. События глобальных сервисов, таких как IAM, нужно искать в `us-east-1`.

### Шаг 12. Разберите запись

Нажмите на событие с `User name` `lab-test`.

![13.1.6. Подробности отклонённого вызова](../_images/13/hands_on/ho1_06_event_details.jpg)

_13.1.6. Подробности отклонённого вызова_

В блоке `Details`:

- `AWS access key` (_16_) начинается с `ASIA`: вызов подписан временным ключом роли.
- `Source IP address` (_17_) - адрес, с которого пришёл запрос. Здесь это адрес CloudShell в сети AWS.
- `Error code`: `AccessDenied` (_18_). Неудачные вызовы записываются в журнал так же, как удачные, и для расследования они не менее важны.

Блок `Resources referenced` пуст: вызов ничего не создал.

Прокрутите страницу до блока `Event record`. В нём полная запись события в JSON (сокращённо):

```json
{
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::111122223333:assumed-role/dev-function-role/lab-test",
    "accessKeyId": "ASIAIOSFODNN7EXAMPLE",
    "sessionContext": {
      "sessionIssuer": {
        "type": "Role",
        "arn": "arn:aws:iam::111122223333:role/dev-function-role"
      }
    }
  },
  "eventTime": "2026-11-24T09:42:18Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "CreateRole",
  "awsRegion": "us-east-1",
  "errorCode": "AccessDenied",
  "errorMessage": "User: arn:aws:sts::111122223333:assumed-role/dev-function-role/lab-test is not authorized to perform: iam:CreateRole ... because no permissions boundary allows the iam:CreateRole action ..."
}
```

Поля отвечают на вопросы расследования[^5]:

| Поле                                             | Вопрос                 | Ответ в записи                                     |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------- |
| `userIdentity.type`                              | Какой вид принципала?  | `AssumedRole` - роль, принятая через STS           |
| `userIdentity.sessionContext.sessionIssuer.arn`  | Какая роль?            | `dev-function-role`                                |
| `userIdentity.accessKeyId`                       | Каким ключом?          | Временный ключ `ASIA...`                           |
| `eventName`                                      | Что пытались сделать?  | Создать роль                                       |
| `errorCode`                                      | Чем закончилось?       | Отказом `AccessDenied`                             |

Запись говорит, что вызов выполнила роль. Но роль сама ничего не делает: кто-то её принял. Чтобы узнать кто, найдём вызов `AssumeRole`.

### Шаг 13. Найдите, кто принял роль

Вернитесь в регион `Europe (Frankfurt)` и снова откройте `Event history`. CloudShell обращается к STS в своём регионе, поэтому `AssumeRole` записан здесь.

В `Lookup attributes` выберите `User name` и введите имя своего пользователя IAM. Найдите событие `AssumeRole` с ресурсом `dev-function-role` и откройте его. Если таких событий несколько, откройте ближайшее по времени к отклонённому `CreateRole`: когда временные учётные данные истекают, CLI принимает роль заново.

![13.1.7. Вызов AssumeRole](../_images/13/hands_on/ho1_07_assume_role.jpg)

_13.1.7. Вызов AssumeRole_

В записи события найдите:

- `userIdentity.arn` (_19_) - ваш пользователь IAM. Это он принял роль.
- `requestParameters.roleSessionName` (_20_): `lab-test` - то самое имя сессии.
- `responseElements.credentials.accessKeyId` (_21_) - ключ, который STS выдал в ответ. Он совпадает с `accessKeyId` в записи `CreateRole` из шага 12.

Совпадение ключа связывает два события в одну цепочку: ваш пользователь принял роль, получил временный ключ, и этим ключом была сделана попытка создать роль. Так по журналу находят человека за действиями роли.

### Шаг 14. Проверьте, чего нет в истории

В `Event history` региона `Europe (Frankfurt)` найдите по `Event name` два вызова из части 2:

- `CreateLogStream`. Отклонённый вызов из шага 9 есть в истории: создание потока журнала - событие управления.
- `GetObject`. Чтения файла из шага 6 в истории нет. Чтение объекта S3 - событие данных, и CloudTrail не записывает такие события, пока для бакета не включена их запись[^1].

Поэтому история событий не отвечает на вопрос "кто прочитал файл". Для этого нужен trail с включённой записью событий данных S3, как в примере из раздела "AWS CloudTrail" главы.

## Часть 4. Публичный бакет и IAM Access Analyzer

### Шаг 15. Создайте анализатор внешнего доступа

Откройте `IAM` → `Access Analyzer` → `Analyser settings` и нажмите `Create analyser`.

![13.1.8. Создание анализатора внешнего доступа](../_images/13/hands_on/ho1_08_analyzer_create.jpg)

_13.1.8. Создание анализатора внешнего доступа_

1. `Finding type`: `Resource analysis - external access` (_22_). Под вариантом указано `Cost: no additional cost`. Два других вида анализа, внутренний доступ и неиспользуемый доступ, платные.
2. `Name`: `security-lab` (_23_).
3. `Zone of trust`: `Current account` (_24_). _Зона доверия (zone of trust)_ - аккаунт или организация, доступ внутри которых считается своим. Анализатор сообщает о каждом ресурсе, к которому есть доступ извне зоны доверия[^2].

Нажмите `Create analyser`. Консоль откроет страницу `External access`. Находок о роли `dev-function-role` и бакете `security-lab-...` нет: роль доверяет вашему же аккаунту, поэтому это не внешний доступ, а бакет пока закрыт.

Если в аккаунте остались ресурсы из прошлых занятий, анализатор может показать находки о них. Например, роль `github-actions-catalog` из Hands-on 12.2 доверяет GitHub, то есть принципалу вне вашего аккаунта.

Анализатор работает в одном регионе. Для ресурсов в другом регионе нужен свой анализатор.

### Шаг 16. Откройте бакет для чтения всем

Откройте `S3` → бакет `security-lab-...` → вкладку `Permissions`.

В блоке `Block public access (bucket settings)` нажмите `Edit`, снимите флажок `Block all public access` и нажмите `Save changes`. Введите `confirm` и нажмите `Confirm`. Блокировка публичного доступа по умолчанию включена у каждого нового бакета, и пока она включена, S3 не сохранит публичную политику.

Ниже в блоке `Bucket policy` нажмите `Edit` и вставьте политику, подставив номер своего аккаунта:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::security-lab-111122223333/*"
    }
  ]
}
```

Нажмите `Save changes`. `Principal` со значением `*` означает любого, в том числе анонимного пользователя без учётных данных AWS. Проверьте это: откройте в браузере адрес с номером своего аккаунта:

```text
https://security-lab-111122223333.s3.eu-central-1.amazonaws.com/hello.txt
```

Браузер покажет `hello from security lab`. Браузер не подписывает запрос ключами AWS, поэтому файл отдан анонимному посетителю. Именно так выглядит утечка через открытый бакет из таблицы триады CIA в главе.

> [!TIP]
> Если при сохранении политики консоль показывает ошибку доступа, в аккаунте включена блокировка публичного доступа на уровне всего аккаунта: `S3` → `Block Public Access settings for this account`. Она сильнее настройки бакета. В рабочем аккаунте её не выключают. Для занятия можно выключить её на время и обязательно включить обратно в части 7.

### Шаг 17. Найдите находку анализатора

Вернитесь в `IAM` → `Access Analyzer` → `External access`. Через одну-две минуты обновите список.

![13.1.9. Находка о публичном бакете](../_images/13/hands_on/ho1_09_analyzer_finding.jpg)

_13.1.9. Находка о публичном бакете_

В `Findings` появилась одна находка:

- `Resource` (_25_): бакет `security-lab-...`, тип `S3 Bucket`.
- `External principal` (_26_): `All principals` - доступ есть у всех.
- `Shared through` (_27_): `Bucket policy` - доступ открыт политикой бакета.
- `Access level` (_28_): `Read`.
- `Status` (_29_): `Active` - доступ есть прямо сейчас.

Нажмите на `Finding ID`. Страница находки откроется в новой вкладке.

![13.1.10. Подробности находки](../_images/13/hands_on/ho1_10_finding_details.jpg)

_13.1.10. Подробности находки_

Сверху предупреждение `Public: this finding is for a resource that allows public access` (_30_). В `Access level` (_31_) перечислены разрешённые действия: `s3:GetObject`. Внизу в блоке `Next steps` два пути (_32_):

- `Intended access`. Если доступ нужен, например бакет хранит картинки публичного сайта, находку архивируют кнопкой `Archive`, и она уходит из активных.
- `Not intended`. Если доступ открыт по ошибке, его закрывают в настройках ресурса. Тогда статус находки сменится на `Resolved`.

Мы закроем бакет в шаге 21. Сначала посмотрим, что о нём скажет AWS Config.

## Часть 5. Проверка настроек в AWS Config

### Шаг 18. Включите запись конфигурации

Откройте сервис `Config`. Если Config в регионе ещё не настроен, консоль покажет стартовую страницу. Нажмите `Get started`, а не `1-click setup`: быстрая настройка записывает все виды ресурсов, и плата за неё выше.

![13.1.11. Что записывает AWS Config](../_images/13/hands_on/ho1_11_config_recording.jpg)

_13.1.11. Что записывает AWS Config_

1. `Recording strategy`: `Specific resource types` (_33_). Config будет записывать только выбранные виды ресурсов.
2. `Resource type`: `AWS S3 Bucket` (_34_).
3. `Frequency`: `Continuous` (_35_). Config запишет изменение бакета сразу, как только оно произойдёт. При `Daily` он записал бы состояние раз в сутки, и в этом занятии изменение пришлось бы ждать до завтра.

Ниже оставьте значения по умолчанию:

- `IAM role for AWS Config`: `Create AWS Config service-linked role`. Config получит роль с правами читать настройки ресурсов.
- `Delivery channel`: `Create a bucket` с именем `config-bucket-<номер аккаунта>`. В этот бакет Config складывает историю конфигураций.

Нажмите `Next`.

### Шаг 19. Добавьте правило

На странице `Rules` в поиске введите `public-read` и выберите в подсказке `Name = s3-bucket-public-read-prohibited`.

![13.1.12. Управляемое правило s3-bucket-public-read-prohibited](../_images/13/hands_on/ho1_12_config_rule.jpg)

_13.1.12. Управляемое правило s3-bucket-public-read-prohibited_

- `Trigger type`: `HYBRID` (_36_). Правило срабатывает и при каждом изменении бакета, и периодически, раз в сутки[^6].
- `Description` (_37_): правило проверяет блокировку публичного доступа, политику бакета и список управления доступом (ACL). Бакет нарушает правило, если хотя бы одна из этих настроек открывает чтение всем.

Отметьте правило, нажмите `Next`, проверьте сводку на странице `Review` и нажмите `Confirm`. Консоль откроет `Dashboard`, а Config начнёт обнаруживать бакеты региона.

### Шаг 20. Посмотрите результат проверки

Через одну-две минуты откройте `Rules` → `s3-bucket-public-read-prohibited`.

![13.1.13. Бакет нарушает правило](../_images/13/hands_on/ho1_13_config_noncompliant.jpg)

_13.1.13. Бакет нарушает правило_

- `Detective compliance` (_38_): `Noncompliant resource(s)`. У правила есть хотя бы один несоответствующий ресурс.
- В блоке `Resources in scope` с фильтром `Noncompliant` (_39_) - бакет `security-lab-...`.
- `Annotation` (_40_): `The S3 bucket policy allows public read access`. Config указывает, какая именно настройка нарушает правило.

Бакет `config-bucket-...`, который Config создал сам, проверку проходит: его можно увидеть, если выбрать в фильтре `Compliant`.

Анализатор и правило нашли одну и ту же ошибку, но отвечают на разные вопросы. Access Analyzer говорит, _кто_ получает доступ извне зоны доверия: роль другого аккаунта, организация или все. Правило Config говорит, _соответствует ли настройка_ правилу компании, и проверяет не только доступ: в каталоге больше 700 управляемых правил, например о шифровании томов или включённом журнале.

## Часть 6. Исправление и история

### Шаг 21. Закройте бакет

Откройте бакет `security-lab-...` → вкладку `Permissions`:

1. В блоке `Bucket policy` нажмите `Delete` и подтвердите удаление политики.
2. В блоке `Block public access (bucket settings)` нажмите `Edit`, отметьте `Block all public access`, нажмите `Save changes` и введите `confirm`.

Обновите в браузере страницу с адресом `hello.txt` из шага 16. Теперь S3 отвечает ошибкой:

```xml
<Error>
<Code>AccessDenied</Code>
<Message>Access Denied</Message>
...
</Error>
```

Анонимный запрос больше не проходит.

### Шаг 22. Убедитесь, что оба сервиса заметили исправление

Через минуту откройте правило `s3-bucket-public-read-prohibited` и выберите в фильтре `Resources in scope` значение `Compliant`. Бакет `security-lab-...` теперь в этом списке. Config проверил его заново сам, сразу после изменения настройки: так работает срабатывание по изменению.

Откройте `Access Analyzer` → `External access`. Со статусом `Active` находок нет. Выберите в фильтре `Status` значение `Resolved`: находка о бакете там. Анализатор тоже заметил изменение политики без ручного запуска.

### Шаг 23. Посмотрите историю бакета

В `Config` откройте `Resources`, найдите бакет `security-lab-...` и нажмите `Resource Timeline`.

![13.1.14. Временная шкала бакета](../_images/13/hands_on/ho1_14_config_timeline.jpg)

_13.1.14. Временная шкала бакета_

На шкале чередуются события двух видов:

- `Configuration change` (_41_) - снимки конфигурации бакета, которые записал Config.
- `CloudTrail Event` (_42_) - вызовы API, которые изменили бакет. Раскройте их: это `DeleteBucketPolicy` и `PutBucketPublicAccessBlock` из шага 21, с именем вашего пользователя.

Раскройте верхнее событие `Configuration change`. Config показывает разницу между двумя снимками (`JSON diff`): поле `policyText` с политикой `PublicRead` (_43_) стало `null`, а четыре флага в `PublicAccessBlockConfiguration` (_44_) сменились с `false` на `true`.

Это пример из раздела "AWS Config" главы на живом бакете. Config показывает, _каким_ был ресурс до и после, а CloudTrail - _кто_ и каким вызовом его изменил. На одной шкале видны оба ответа.

## Часть 7. Удаление ресурсов

Удалите ресурсы в таком порядке:

1. Правило Config. Откройте `Rules` → `s3-bucket-public-read-prohibited`, выберите `Actions` → `Delete rule`, введите `confirm` и нажмите `Delete`. Правило удаляется не сразу: несколько минут оно остаётся в списке.
2. Запись Config, оба бакета и профиль `dev`. Консоль позволяет только остановить запись Config, а удалить её настройку можно из CloudShell. Выполните команды:

   ```bash
   aws configservice stop-configuration-recorder --configuration-recorder-name default
   aws configservice delete-delivery-channel --delivery-channel-name default
   aws configservice delete-configuration-recorder --configuration-recorder-name default
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   aws s3 rb s3://config-bucket-$ACCOUNT --force
   aws s3 rb s3://security-lab-$ACCOUNT --force
   rm ~/.aws/config
   ```

   Первые три команды останавливают запись, удаляют канал доставки и сам регистратор (configuration recorder). Пока регистратор не остановлен, Config продолжает записывать изменения бакетов и брать за это плату. Команда `aws s3 rb` с ключом `--force` сначала удаляет все объекты бакета, а затем сам бакет. Последняя команда удаляет файл с профилем `dev`. Если вы создавали в CloudShell другие профили, вместо неё удалите из `~/.aws/config` только блок `[profile dev]`.
3. Анализатор. В `Access Analyzer` → `Analyser settings` отметьте `security-lab` и нажмите `Delete`.
4. IAM. Удалите роль `dev-function-role`, затем политики `DevRolePolicy` и `DevBoundary`. Политику нельзя удалить, пока она прикреплена к роли, поэтому роль удаляют первой.
5. Если в шаге 16 вы выключали блокировку публичного доступа на уровне аккаунта, включите её обратно.

Роль `AWSServiceRoleForConfig` и роль `AWSServiceRoleForAccessAnalyzer` можно оставить: это служебные роли, они ничего не стоят и понадобятся, если вы снова включите эти сервисы.

## Вопросы для самопроверки

1. Роли выдана политика с `iam:CreateRole`, но вызов `CreateRole` отклонён. По какой фразе в сообщении об ошибке видно, что причина в границе, а не в политике роли?
2. Почему граница `DevBoundary` разрешает `logs:CreateLogStream`, а роль всё равно не может создать поток журнала?
3. Почему отклонённый вызов `CreateRole` нужно искать в истории событий региона `us-east-1`, а `AssumeRole` - в `eu-central-1`?
4. В записи CloudTrail вызов выполнила роль. Как по журналу найти человека, который её принял?
5. Почему чтения файла из бакета нет в истории событий CloudTrail и что нужно включить, чтобы оно там появилось?
6. Почему анализатор не выдал находку о роли `dev-function-role`, хотя её можно принять?
7. Чем отвечает на открытый бакет IAM Access Analyzer и чем AWS Config? Зачем в аккаунте нужны оба сервиса?
8. Почему после исправления бакета не понадобилось вручную запускать проверку правила?

[^1]: Amazon Web Services (2026). _Working with CloudTrail event history_. AWS CloudTrail User Guide. Available at: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html

[^2]: Amazon Web Services (2026). _Using AWS Identity and Access Management Access Analyzer_. IAM User Guide. Available at: https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html

[^3]: Amazon Web Services (2026). _AWS Config Pricing_. Available at: https://aws.amazon.com/config/pricing/

[^4]: Amazon Web Services (2026). _Understanding CloudTrail events: global service events_. AWS CloudTrail User Guide. Available at: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html#cloudtrail-concepts-global-service-events

[^5]: Amazon Web Services (2026). _CloudTrail userIdentity element_. AWS CloudTrail User Guide. Available at: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html

[^6]: Amazon Web Services (2026). _s3-bucket-public-read-prohibited_. AWS Config Developer Guide. Available at: https://docs.aws.amazon.com/config/latest/developerguide/s3-bucket-public-read-prohibited.html
