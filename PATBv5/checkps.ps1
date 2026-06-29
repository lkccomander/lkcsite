# This script collects a few basic system details with WMI and prints them as a table.
Add-Type -AssemblyName System.Management

# BROKEN: $cpuCount = Get-WmiObject Win32_ComputerSystem | Select-Object @{ Name='CPU Count'; Expression= { $_.NumberOfProcessors } }, 'CSV'
# Why it fails: 'CSV' is treated like a property name here, so the command shape is invalid for the intended output.
$cpuCount = (Get-WmiObject Win32_ComputerSystem).NumberOfProcessors

# BROKEN: $totalPhysicalMemory = Get-WmiObject Win32_ComputerSystem | Select-Object @{ Name='Total Physical Memory'; Expression= {[math]::Round(($_.TotalPhysicalMemory/1MB), 2)} } 'GB',
# Why it fails: the string 'GB' is outside the calculated property, and the trailing comma leaves the assignment incomplete.
$totalPhysicalMemoryGb = [math]::Round(((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB), 2)

# BROKEN: $os = Get-WmiObject Win32_OperatingSystem | Select-Object @{ Name='OS'; Expression= { $_.Caption + " ("+ $_.Name +')'} } 'CSV',
# Why it fails: 'CSV' is again an invalid extra argument, and the trailing comma makes PowerShell expect another value.
$osInfo = Get-WmiObject Win32_OperatingSystem
$os = "{0} ({1})" -f $osInfo.Caption, $osInfo.Name

# BROKEN: $lastBoot = Get-WmiObject Win32_OperatingSystem | Select-Object @{ Name='Last Boot'; Expression= { $(Get-Date -date $_.ConvertToDateTime($_.LastBootUpTime)).ToString() } }, 'CSV',
# Why it fails: the extra 'CSV' token is invalid, and in some sessions the WMI object is deserialized so it does not expose the instance method 'ConvertToDateTime'.
$lastBoot = [System.Management.ManagementDateTimeConverter]::ToDateTime($osInfo.LastBootUpTime).ToString()

# BROKEN: $freeSpace = Get-WmiObject Win32_OperatingSystem | Select-Object @{ Name='Free Space'; Expression= {[math]::Round(($_.FreePhysicalMemory/1MB), 2)} } 'GB',
# Why it fails: 'FreePhysicalMemory' is reported in KB, and the extra 'GB' token breaks the expression.
$freePhysicalMemoryGb = [math]::Round((($osInfo.FreePhysicalMemory * 1KB) / 1GB), 2)

# BROKEN: $systemType = (Get-WmiObject Win32_OperatingSystem).OSArchitecture, '#Query OS architecture'
# Why it fails: the trailing comma turns the value into an array and the inline text becomes unexpected data instead of a comment.
$systemType = $osInfo.OSArchitecture

# BROKEN: $bit = (Get-WmiObject Win32_Processor).NumberOfCores,
# Why it fails: the trailing comma leaves an incomplete expression and returns an array-like value instead of a clean number.
$coreCount = (Get-WmiObject Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum

# BROKEN: [PS] C:\> Get-WmiObject Win32_ComputerSystem,Win32_OperatingSystem | Select * | ConvertTo-Table -AutoSize
# Why it fails: '[PS] C:\>' is a pasted console prompt, not script syntax, and 'ConvertTo-Table' is not a valid PowerShell cmdlet.
[pscustomobject]@{
    CpuCount              = $cpuCount
    TotalPhysicalMemoryGb = $totalPhysicalMemoryGb
    OS                    = $os
    LastBoot              = $lastBoot
    FreePhysicalMemoryGb  = $freePhysicalMemoryGb
    OSArchitecture        = $systemType
    CpuCoreCount          = $coreCount
} | Format-Table -AutoSize
