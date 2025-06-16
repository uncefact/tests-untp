import React, { useEffect, useState } from 'react';
import { FileJson, FileTextIcon } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTestReport } from '@/contexts/TestReportContext';
import { DownloadReportFormat } from '@/types';

export const DownloadReport = () => {
  const [selectedValue, setSelectedValue] = useState('');
  const { canDownloadReport, downloadReport } = useTestReport();
  const downloadOptions = [
    {
      value: DownloadReportFormat.HTML,
      label: 'HTML',
      icon: <FileTextIcon />,
      action: () => downloadReport(DownloadReportFormat.HTML),
    },
    {
      value: DownloadReportFormat.JSON,
      label: 'JSON',
      icon: <FileJson />,
      action: () => downloadReport(DownloadReportFormat.JSON),
    },
  ];

  const handleDownload = (value: DownloadReportFormat) => {
    setSelectedValue(value);
    const selectedOption = downloadOptions.find((option) => option.value === value);
    if (selectedOption) {
      selectedOption.action();
    }

    setSelectedValue('');
  };

  useEffect(() => {
    if (!canDownloadReport) {
      setSelectedValue('');
    }
  }, [canDownloadReport]);

  return (
    <Select value={selectedValue} onValueChange={handleDownload}>
      <SelectTrigger
        className='focus:ring-0 focus:ring-transparent focus:ring-offset-0 bg-black text-white'
        disabled={!canDownloadReport}
      >
        <SelectValue placeholder='Download Report' />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {downloadOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className='flex items-center' data-testid='download-report-select-item'>
                {option.icon} {option.label}
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
