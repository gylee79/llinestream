'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fields as mockFields, classifications as mockClassifications, courses as mockCourses } from '@/lib/data';
import type { Field, Classification, Course } from '@/lib/types';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const Column = ({ title, items, selectedId, onSelect, onAdd, onEdit, onDelete }: {
  title: string;
  items: { id: string, name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) => (
  <Card className="flex-1">
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle className="text-lg">{title}</CardTitle>
      <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-4 w-4 mr-2" /> 추가</Button>
    </CardHeader>
    <CardContent>
      <div className="flex flex-col gap-2">
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`flex items-center justify-between p-2 rounded-md cursor-pointer ${selectedId === item.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
          >
            <span>{item.name}</span>
            <div className="flex gap-2">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(item.id); }}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

export default function HierarchyManager() {
  const [fields, setFields] = useState<Field[]>(mockFields);
  const [classifications, setClassifications] = useState<Classification[]>(mockClassifications);
  const [courses, setCourses] = useState<Course[]>(mockCourses);

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

  const handleSelectField = (id: string) => {
    setSelectedField(id);
    setSelectedClassification(null);
  };
  
  const filteredClassifications = classifications.filter(c => c.fieldId === selectedField);
  const filteredCourses = courses.filter(c => c.classificationId === selectedClassification);

  // Mock functions for add/edit/delete
  const handleAdd = (type: string) => alert(`'${type}' 추가 기능 (구현 필요)`);
  const handleEdit = (type: string, id: string) => alert(`'${type}' (ID: ${id}) 수정 기능 (구현 필요)`);
  const handleDelete = (type: string, id: string) => alert(`'${type}' (ID: ${id}) 삭제 기능 (구현 필요)`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>계층 구조 관리</CardTitle>
        <p className="text-sm text-muted-foreground">분야 &gt; 큰분류 &gt; 상세분류 순서로 콘텐츠 계층을 관리합니다.</p>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <Column
            title="분야 (Field)"
            items={fields}
            selectedId={selectedField}
            onSelect={handleSelectField}
            onAdd={() => handleAdd('분야')}
            onEdit={(id) => handleEdit('분야', id)}
            onDelete={(id) => handleDelete('분야', id)}
          />
          <Column
            title="큰분류 (Classification)"
            items={filteredClassifications}
            selectedId={selectedClassification}
            onSelect={setSelectedClassification}
            onAdd={() => handleAdd('큰분류')}
            onEdit={(id) => handleEdit('큰분류', id)}
            onDelete={(id) => handleDelete('큰분류', id)}
          />
          <Column
            title="상세분류 (Course)"
            items={filteredCourses}
            selectedId={null} // Courses are leaf nodes in this view
            onSelect={() => {}}
            onAdd={() => handleAdd('상세분류')}
            onEdit={(id) => handleEdit('상세분류', id)}
            onDelete={(id) => handleDelete('상세분류', id)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
