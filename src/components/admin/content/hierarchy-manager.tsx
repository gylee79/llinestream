'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Field, Classification, Course } from '@/lib/types';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, deleteDoc } from 'firebase/firestore';
import { setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { v4 as uuidv4 } from 'uuid';

const Column = ({ title, items, selectedId, onSelect, onAdd, onEdit, onDelete, isLoading, collectionName }: {
  title: string;
  items: { id: string, name: string }[] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onEdit: (id: string, name: string) => void;
  onDelete: (collectionName: 'fields' | 'classifications' | 'courses', id: string, name: string) => void;
  isLoading: boolean;
  collectionName: 'fields' | 'classifications' | 'courses';
}) => (
  <Card className="flex-1">
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle className="text-lg">{title}</CardTitle>
      <Button size="sm" variant="outline" onClick={onAdd}><Plus className="h-4 w-4 mr-2" /> 추가</Button>
    </CardHeader>
    <CardContent>
        {isLoading ? (
            <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
            </div>
        ) : (
            <div className="flex flex-col gap-2">
                {items?.map(item => (
                <div
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer ${selectedId === item.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                >
                    <span>{item.name}</span>
                    <div className="flex gap-2">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(item.id, item.name); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(collectionName, item.id, item.name); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                </div>
                ))}
            </div>
        )}
    </CardContent>
  </Card>
);

type DialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};

export default function HierarchyManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

  const [dialogState, setDialogState] = useState<DialogState>({ isOpen: false, item: null, type: '분야' });

  const fieldsQuery = useMemoFirebase(() => collection(firestore, 'fields'), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemoFirebase(() =>
    selectedField ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedField)) : null,
    [firestore, selectedField]
  );
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemoFirebase(() =>
    selectedClassification ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassification)) : null,
    [firestore, selectedClassification]
  );
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);
  
  useEffect(() => {
    if (selectedField && fields && !fields.find(f => f.id === selectedField)) {
      setSelectedField(null);
    }
  }, [fields, selectedField]);

  useEffect(() => {
    if (selectedClassification && classifications && !classifications.find(c => c.id === selectedClassification)) {
      setSelectedClassification(null);
    }
  }, [classifications, selectedClassification]);

  const handleSelectField = (id: string | null) => {
    setSelectedField(id);
    setSelectedClassification(null);
  };

  const handleSelectClassification = (id: string | null) => {
    setSelectedClassification(id);
  };

  const openDialog = (type: DialogState['type'], item: HierarchyItem | null = null) => {
    if ((type === '큰분류' && !selectedField) || (type === '상세분류' && !selectedClassification)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setDialogState({ isOpen: true, item, type });
  };

  const closeDialog = () => setDialogState({ isOpen: false, item: null, type: '분야' });

  const handleSave = (item: HierarchyItem) => {
    const newId = uuidv4();

    if (dialogState.item) { // Edit mode
        const collectionName = dialogState.type === '분야' ? 'fields' : dialogState.type === '큰분류' ? 'classifications' : 'courses';
        updateDocumentNonBlocking(doc(firestore, collectionName, item.id), { name: item.name });
        toast({ title: '성공', description: `${dialogState.type} '${item.name}'이(가) 수정되었습니다.` });
    } else { // Add mode
        let collectionName = '';
        let data: any = { id: newId, name: item.name };

        if (dialogState.type === '분야') {
            collectionName = 'fields';
        } else if (dialogState.type === '큰분류') {
            collectionName = 'classifications';
            data.fieldId = selectedField;
            data.description = "새로운 분류 설명";
            data.prices = { day1: 0, day30: 0, day60: 0, day90: 0 };
        } else if (dialogState.type === '상세분류') {
            collectionName = 'courses';
            data.classificationId = selectedClassification;
            data.description = "새로운 상세분류 설명";
            data.thumbnailUrl = `https://picsum.photos/seed/${newId}/600/400`;
            data.thumbnailHint = 'placeholder image';
        }
        
        if (collectionName) {
            const docRef = doc(firestore, collectionName, newId);
            setDocumentNonBlocking(docRef, data, { merge: false });
            toast({ title: '성공', description: `${dialogState.type} '${item.name}'이(가) 추가되었습니다.` });
        }
    }
    closeDialog();
  };

  const handleDelete = async (collectionName: 'fields' | 'classifications' | 'courses', id: string, name: string) => {
    if (!confirm(`정말로 '${name}' 항목을 삭제하시겠습니까? 하위 항목이 있는 경우 함께 삭제되지 않으니 주의해주세요. 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
      await deleteDoc(doc(firestore, collectionName, id));

      toast({ title: '삭제 성공', description: `'${name}' 항목이 성공적으로 삭제되었습니다.` });

      // State reset to force re-fetch
      if (collectionName === 'fields' && selectedField === id) {
          setSelectedField(null);
          setSelectedClassification(null);
      }
      if (collectionName === 'classifications' && selectedClassification === id) {
          setSelectedClassification(null);
      }

    } catch (error) {
      console.error("Error deleting document: ", error);
      toast({ variant: 'destructive', title: '삭제 실패', description: '항목 삭제 중 오류가 발생했습니다.' });
    }
  };

  return (
    <>
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
              onAdd={() => openDialog('분야')}
              onEdit={(id, name) => openDialog('분야', { id, name })}
              onDelete={handleDelete}
              isLoading={fieldsLoading}
              collectionName="fields"
            />
            <Column
              title="큰분류 (Classification)"
              items={classifications}
              selectedId={selectedClassification}
              onSelect={handleSelectClassification}
              onAdd={() => openDialog('큰분류')}
              onEdit={(id, name) => openDialog('큰분류', { id, name })}
              onDelete={handleDelete}
              isLoading={!selectedField || classificationsLoading}
              collectionName="classifications"
            />
            <Column
              title="상세분류 (Course)"
              items={courses}
              selectedId={null} // Courses are leaf nodes in this view
              onSelect={() => {}}
              onAdd={() => openDialog('상세분류')}
              onEdit={(id, name) => openDialog('상세분류', { id, name })}
              onDelete={handleDelete}
              isLoading={!selectedClassification || coursesLoading}
              collectionName="courses"
            />
          </div>
        </CardContent>
      </Card>
      {dialogState.isOpen && (
        <HierarchyItemDialog
          isOpen={dialogState.isOpen}
          onClose={closeDialog}
          onSave={handleSave}
          item={dialogState.item}
          itemType={dialogState.type}
        />
      )}
    </>
  );
}
